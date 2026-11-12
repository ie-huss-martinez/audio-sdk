import { createWorkerClient, type WorkerClient, type WorkerLike } from "@hussmartinez/sdk-core";
import { asAudioError, throwIfAborted } from "../core/errors/abort.js";
import { AudioError } from "../core/errors/audio-error.js";
import type { AudioPeaks, AudioProbe, DecodedAudio } from "../core/model/source.js";
import type { AudioEngine } from "../core/ports/audio-engine.js";
import type { AudioWorkerContract } from "./audio-worker/contract.js";
import type { PcmLayout } from "./pcm/layout.js";
import { type BucketPeaks, buildPyramid, FINEST_BUCKET } from "./peaks.js";
import {
  decodeOnPage,
  type PlatformDecoder,
  webAudioDecoder,
} from "./web-audio/platform-decode.js";

/**
 * Frames per block between the page and the worker: at most 2¹⁶ per
 * channel (docs/adr/0002), and a whole number of finest peak buckets.
 */
const BLOCK_FRAMES = 65_536;

/**
 * Options for {@link createAudioEngine}.
 *
 * @public
 */
export interface AudioEngineOptions {
  /**
   * Milliseconds without calls after which the worker stops. It starts again
   * on the next call. Defaults to sdk-core's 30 seconds.
   */
  readonly idleTimeout?: number;
}

/** An `AudioBuffer`, or what tests use in its place. */
export interface WritableAudio extends DecodedAudio {
  copyToChannel(source: Float32Array, channel: number, startInChannel: number): void;
}

/** What the engine needs from its environment, replaceable in tests. */
export interface EngineEnvironment {
  /** Loads the worker's code, on the first call, and returns how to start it. */
  readonly loadWorker: () => Promise<() => WorkerLike>;
  /** Creates an empty buffer for a decoded source. Throws for a sample rate it can't hold. */
  readonly createBuffer: (options: {
    numberOfChannels: number;
    length: number;
    sampleRate: number;
  }) => WritableAudio;
  /** Decodes compressed files on the page (sdk-core ADR 0031). */
  readonly decodePlatform: PlatformDecoder;
  readonly idleTimeout?: number;
}

/**
 * Creates the SDK's audio engine (docs/adr/0001, docs/adr/0002). It probes
 * files in its worker: WAV and AIFF, FLAC, native or in Ogg, MP3, and AAC in
 * ADTS, walking every frame of a compressed file to bound its decoded
 * length. It parses WAV and AIFF
 * block by block into an `AudioBuffer`, building the waveform overview as it
 * goes. It decodes compressed files with the browser's own decoder, on the page, under
 * sdk-core ADR 0031's rules: only probed files, a fresh buffer, the output
 * checked against the probe's bound, errors by code, and the time limit of
 * the caller's signal. Other containers fail with `UNSUPPORTED_FORMAT` until
 * their readers are added.
 *
 * Nothing starts until the first call. The worker is inlined, which needs
 * `worker-src blob:` in a Content Security Policy, and it makes no requests.
 *
 * @example
 * ```ts
 * const engine = createAudioEngine();
 * const probe = await engine.probe(file);
 * policy.check("maxDuration", (probe.frameBound / probe.sampleRate) * 1000);
 * const audio = await engine.decode(file, probe, { onProgress });
 * ```
 *
 * @public
 */
export function createAudioEngine(options: AudioEngineOptions = {}): AudioEngine {
  return createEngine({
    loadWorker: async () => (await import("./audio-worker/inline-worker.js")).createInlineWorker,
    createBuffer: (bufferOptions) => new AudioBuffer(bufferOptions),
    decodePlatform: webAudioDecoder,
    ...(options.idleTimeout === undefined ? {} : { idleTimeout: options.idleTimeout }),
  });
}

/**
 * The engine, with its environment passed in.
 *
 * @internal
 */
export function createEngine(environment: EngineEnvironment): AudioEngine {
  let startWorker: (() => WorkerLike) | undefined;
  let destroyed = false;
  const layouts = new WeakMap<AudioProbe, PcmLayout>();
  /** Probes of compressed files this engine made, which decode can trust. */
  const compressedProbes = new WeakSet<AudioProbe>();
  const finestPeaks = new WeakMap<DecodedAudio, BucketPeaks>();

  const newClient = () =>
    createWorkerClient<AudioWorkerContract>({
      createWorker: () => {
        if (!startWorker) {
          throw new AudioError("WORKER_START_FAILED", "The audio worker hasn't loaded.");
        }
        return startWorker();
      },
      errorClasses: { AudioError },
      ...(environment.idleTimeout === undefined ? {} : { idleTimeout: environment.idleTimeout }),
    });
  // Probing, parsing and exports run in order on one client; analysis, such
  // as peaks for audio the worker didn't parse, on another, so cancelling it
  // never fails them as collateral (docs/adr/0002).
  let main: WorkerClient<AudioWorkerContract> | undefined;
  let analysis: WorkerClient<AudioWorkerContract> | undefined;

  async function ready(): Promise<void> {
    if (destroyed) throw new Error("The audio engine has been destroyed.");
    startWorker ??= await environment.loadWorker();
  }

  async function run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw error instanceof RangeError || error instanceof TypeError ? error : asAudioError(error);
    }
  }

  /**
   * Probes the file again for a probe this engine didn't make, such as a
   * copy, and requires it to describe the same audio: a decoder only ever
   * runs on a file whose bound this engine established (sdk-core ADR 0031).
   */
  async function reprobe(file: Blob, probe: AudioProbe, signal?: AbortSignal) {
    main ??= newClient();
    const fresh = await main.call("probe", { file }, signal ? { signal } : {});
    const same =
      fresh.probe.codec === probe.codec &&
      fresh.probe.sampleRate === probe.sampleRate &&
      fresh.probe.channels === probe.channels &&
      fresh.probe.frameBound === probe.frameBound;
    if (!same) {
      throw new AudioError("INVALID_AUDIO", "The probe doesn't describe this file.", {
        details: { container: probe.container },
      });
    }
    return fresh.probe;
  }

  async function layoutOf(file: Blob, probe: AudioProbe, signal?: AbortSignal) {
    const known = layouts.get(probe);
    if (known) return known;
    // A probe the caller rebuilt or copied: read the header again, and make
    // sure it describes the same audio.
    main ??= newClient();
    const fresh = await main.call("probe", { file }, signal ? { signal } : {});
    const same =
      fresh.probe.sampleRate === probe.sampleRate &&
      fresh.probe.channels === probe.channels &&
      fresh.probe.frameBound === probe.frameBound;
    if (!same) {
      throw new AudioError("INVALID_AUDIO", "The probe doesn't describe this file.", {
        details: { container: probe.container },
      });
    }
    if (!fresh.layout) {
      throw new AudioError("UNSUPPORTED_FORMAT", "Compressed formats aren't supported yet.", {
        details: { container: probe.container, codec: probe.codec },
      });
    }
    return fresh.layout;
  }

  return {
    probe(file, options = {}) {
      return run(async () => {
        throwIfAborted(options.signal);
        await ready();
        main ??= newClient();
        const result = await main.call(
          "probe",
          { file },
          options.signal ? { signal: options.signal } : {},
        );
        if (result.layout) layouts.set(result.probe, result.layout);
        else compressedProbes.add(result.probe);
        return result.probe;
      });
    },

    decode(file, probe, options = {}) {
      return run(async () => {
        throwIfAborted(options.signal);
        await ready();
        if (probe.codec !== "pcm") {
          const trusted = compressedProbes.has(probe)
            ? probe
            : await reprobe(file, probe, options.signal);
          const audio = await decodeOnPage(
            file,
            trusted,
            environment.decodePlatform,
            environment.createBuffer,
            options.signal,
          );
          options.onProgress?.(1);
          return audio;
        }
        const layout = await layoutOf(file, probe, options.signal);
        const { frames, channels, sampleRate } = layout;
        let buffer: WritableAudio;
        try {
          buffer = environment.createBuffer({
            numberOfChannels: channels,
            length: frames,
            sampleRate,
          });
        } catch (error) {
          throw new AudioError(
            "UNSUPPORTED_FORMAT",
            "This browser can't hold audio at this rate.",
            {
              details: { container: layout.container, sampleRate },
              cause: error,
            },
          );
        }

        const buckets = Math.ceil(frames / FINEST_BUCKET);
        const peaks: BucketPeaks = {
          min: Array.from({ length: channels }, () => new Float32Array(buckets)),
          max: Array.from({ length: channels }, () => new Float32Array(buckets)),
        };
        main ??= newClient();
        for (let start = 0; start < frames; start += BLOCK_FRAMES) {
          const block = await main.call(
            "readBlock",
            {
              file,
              layout,
              start,
              frames: Math.min(BLOCK_FRAMES, frames - start),
              bucket: FINEST_BUCKET,
            },
            options.signal ? { signal: options.signal } : {},
          );
          const at = start / FINEST_BUCKET;
          for (let c = 0; c < channels; c += 1) {
            buffer.copyToChannel(block.channels[c] as Float32Array, c, start);
            peaks.min[c]?.set(block.min[c] as Float32Array, at);
            peaks.max[c]?.set(block.max[c] as Float32Array, at);
          }
          options.onProgress?.(Math.min(start + BLOCK_FRAMES, frames) / frames);
        }
        if (frames === 0) options.onProgress?.(1);
        finestPeaks.set(buffer, peaks);
        return buffer;
      });
    },

    peaks(audio, options = {}) {
      return run(async (): Promise<AudioPeaks> => {
        throwIfAborted(options.signal);
        const known = finestPeaks.get(audio);
        if (known) return buildPyramid(known, FINEST_BUCKET);
        await ready();
        analysis ??= newClient();
        const buckets = Math.ceil(audio.length / FINEST_BUCKET);
        const peaks: BucketPeaks = {
          min: Array.from({ length: audio.numberOfChannels }, () => new Float32Array(buckets)),
          max: Array.from({ length: audio.numberOfChannels }, () => new Float32Array(buckets)),
        };
        for (let start = 0; start < audio.length; start += BLOCK_FRAMES) {
          const end = Math.min(audio.length, start + BLOCK_FRAMES);
          // Copies of one block, so the source is never transferred away.
          const channels = Array.from({ length: audio.numberOfChannels }, (_, c) =>
            audio.getChannelData(c).slice(start, end),
          );
          const block = await analysis.call(
            "peaks",
            { channels, bucket: FINEST_BUCKET },
            { transfer: true, ...(options.signal ? { signal: options.signal } : {}) },
          );
          const at = start / FINEST_BUCKET;
          for (let c = 0; c < audio.numberOfChannels; c += 1) {
            peaks.min[c]?.set(block.min[c] as Float32Array, at);
            peaks.max[c]?.set(block.max[c] as Float32Array, at);
          }
        }
        finestPeaks.set(audio, peaks);
        return buildPyramid(peaks, FINEST_BUCKET);
      });
    },

    async destroy() {
      destroyed = true;
      main?.destroy();
      analysis?.destroy();
    },
  };
}
