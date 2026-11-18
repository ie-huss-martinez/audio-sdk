import { createWorkerClient, type WorkerClient, type WorkerLike } from "@hussmartinez/sdk-core";
import { asAudioError, throwIfAborted } from "../core/errors/abort.js";
import { AudioError } from "../core/errors/audio-error.js";
import { dbToGain } from "../core/model/envelope.js";
import { gatherSegments, mixLength } from "../core/model/mix.js";
import { assertClip } from "../core/model/plan.js";
import type {
  AudioProcessor,
  AudioRenderJob,
  AudioRenderResult,
  AudioSampleFormat,
} from "../core/ports/audio-processor.js";
import type { AudioWorkerContract } from "./audio-worker/contract.js";
import { type AudioWorkerSource, audioWorkerSource } from "./audio-worker/loader.js";
import { dataSize } from "./wav/wav-writer.js";

/**
 * Frames per output block between the page and the worker: at most 2¹⁶ per
 * channel (docs/adr/0002).
 */
export const EXPORT_BLOCK_FRAMES = 65_536;

const SAMPLE_FORMATS: ReadonlySet<string> = new Set<AudioSampleFormat>([
  "pcm16",
  "pcm24",
  "float32",
]);

/**
 * Options for {@link createAudioProcessor}.
 *
 * @public
 */
export interface AudioProcessorOptions {
  /**
   * Milliseconds without calls after which the worker stops. It starts again
   * on the next call. Defaults to sdk-core's 30 seconds.
   */
  readonly idleTimeout?: number;
  /**
   * Where the application serves the package's `dist/assets/` directory, as
   * for `createAudioEngine` (docs/adr/0002). By default the worker is
   * inlined.
   */
  readonly assetsUrl?: string | URL;
}

/** What the processor needs from its environment, replaceable in tests. */
export interface ProcessorEnvironment extends AudioWorkerSource {
  readonly idleTimeout?: number;
}

/**
 * Creates the SDK's processor (docs/adr/0003, docs/adr/0006): it mixes a
 * plan's audible tracks, with their clips' gain and fades, the tracks' gains
 * and the master gain, and encodes the mix as a WAV file, in its own
 * worker, block by block. The page sends each block's source samples, at
 * most 2¹⁶ frames per channel, and collects the encoded blocks into a
 * `Blob` of parts, so an export never holds the whole file in one buffer.
 *
 * Sources with another channel count mix into the plan's by Web Audio's
 * speaker rules, as playback does. Tracks sum at unity. Samples are clamped
 * to full scale, and the result gives the mix's peak and how many frames
 * were clamped;
 * 16-bit and 24-bit PCM round half away from zero, without dither. Files
 * whose sizes don't fit 32 bits are written as RF64.
 *
 * @example
 * ```ts
 * const processor = createAudioProcessor();
 * const { blob, peakDb, clippedFrames } = await processor.render(
 *   { plan, sources, format: { container: "wav", sampleFormat: "pcm24" } },
 *   { signal, onProgress },
 * );
 * ```
 *
 * @public
 */
export function createAudioProcessor(options: AudioProcessorOptions = {}): AudioProcessor {
  return createProcessor({
    ...audioWorkerSource(options.assetsUrl),
    ...(options.idleTimeout === undefined ? {} : { idleTimeout: options.idleTimeout }),
  });
}

/** Checks a job before any work, as the port promises. */
function check(job: AudioRenderJob): AudioSampleFormat {
  const { plan, sources, format } = job;
  if (format.container !== "wav")
    throw new TypeError(`Can't export to ${String(format.container)}.`);
  const sampleFormat = format.sampleFormat ?? "pcm16";
  if (!SAMPLE_FORMATS.has(sampleFormat)) {
    throw new TypeError(`Unknown sample format ${String(sampleFormat)}.`);
  }
  if (!Number.isSafeInteger(plan.sampleRate) || plan.sampleRate < 1) {
    throw new RangeError("The plan's sample rate must be a whole number above 0.");
  }
  if (!Number.isSafeInteger(plan.channels) || plan.channels < 1) {
    throw new RangeError("The plan's channel count must be a whole number above 0.");
  }
  for (const track of plan.tracks) {
    for (const clip of track.clips) {
      const source = sources.get(clip.source);
      if (!source) {
        throw new TypeError(`Clip ${clip.key}'s source ${clip.source} isn't in the job.`);
      }
      assertClip(clip, source.length);
    }
  }
  return sampleFormat;
}

/**
 * The processor, with its environment passed in.
 *
 * @internal
 */
export function createProcessor(environment: ProcessorEnvironment): AudioProcessor {
  let startWorker: (() => WorkerLike) | undefined;
  let client: WorkerClient<AudioWorkerContract> | undefined;
  let destroyed = false;

  async function ready(): Promise<WorkerClient<AudioWorkerContract>> {
    if (destroyed) throw new Error("The audio processor has been destroyed.");
    startWorker ??= await environment.loadWorker();
    client ??= createWorkerClient<AudioWorkerContract>({
      createWorker: () => {
        if (!startWorker) {
          throw new AudioError("WORKER_START_FAILED", "The audio worker hasn't loaded.");
        }
        return startWorker();
      },
      errorClasses: { AudioError },
      packageVersion: environment.version,
      ...(environment.asset === undefined ? {} : { workerAsset: environment.asset }),
      ...(environment.idleTimeout === undefined ? {} : { idleTimeout: environment.idleTimeout }),
    });
    return client;
  }

  async function render(
    job: AudioRenderJob,
    signal: AbortSignal | undefined,
    onProgress: ((fraction: number) => void) | undefined,
  ): Promise<AudioRenderResult> {
    const { plan, sources } = job;
    const sampleFormat = check(job);
    throwIfAborted(signal);
    const worker = await ready();
    const call = signal ? { signal } : {};
    // What sounds: a muted track neither plays nor pads the file.
    const frames = mixLength(plan);
    const gain = dbToGain(plan.gainDb);
    const spec = { sampleRate: plan.sampleRate, channels: plan.channels, frames, sampleFormat };
    const parts: Uint8Array<ArrayBuffer>[] = [
      await worker.call("wavHeader", { ...spec, metadata: { ...plan.metadata } }, call),
    ];
    let peak = 0;
    let clippedFrames = 0;
    for (let start = 0; start < frames; start += EXPORT_BLOCK_FRAMES) {
      throwIfAborted(signal);
      const length = Math.min(EXPORT_BLOCK_FRAMES, frames - start);
      // Copies of each audible clip's part of the block, which the worker
      // then owns: the sources are never transferred away.
      const segments = gatherSegments(plan, sources, start, length);
      const block = await worker.call(
        "renderBlock",
        { channels: plan.channels, frames: length, gain, sampleFormat, segments },
        { ...call, transfer: true },
      );
      parts.push(block.bytes);
      peak = Math.max(peak, block.peak);
      clippedFrames += block.clipped;
      onProgress?.((start + length) / frames);
    }
    // Chunks are padded to an even size.
    if (dataSize(spec) % 2 === 1) parts.push(new Uint8Array(1));
    if (frames === 0) onProgress?.(1);
    return {
      blob: new Blob(parts, { type: "audio/wav" }),
      peakDb: 20 * Math.log10(peak),
      clippedFrames,
    };
  }

  return {
    async render(job, options = {}) {
      try {
        return await render(job, options.signal, options.onProgress);
      } catch (error) {
        if (error instanceof TypeError || error instanceof RangeError) throw error;
        throw asAudioError(error, "The recording couldn't be exported.");
      }
    },
    async destroy() {
      destroyed = true;
      client?.destroy();
    },
  };
}
