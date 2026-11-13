import { createWorkerClient, type WorkerClient, type WorkerLike } from "@hussmartinez/sdk-core";
import { asAudioError, throwIfAborted } from "../core/errors/abort.js";
import { AudioError } from "../core/errors/audio-error.js";
import { assertClip, clipLength, clipOffsets, planLength } from "../core/model/plan.js";
import type {
  AudioProcessor,
  AudioRenderJob,
  AudioSampleFormat,
} from "../core/ports/audio-processor.js";
import type { AudioWorkerContract } from "./audio-worker/contract.js";
import { type AudioWorkerSource, audioWorkerSource } from "./audio-worker/loader.js";
import type { BlockSegment } from "./wav/render-block.js";
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
 * Creates the SDK's processor (docs/adr/0003): it renders a plan's clips,
 * with their gain and fades, and encodes them as a WAV file, in its own
 * worker, block by block. The page sends each block's source samples, at
 * most 2¹⁶ frames per channel, and collects the encoded blocks into a
 * `Blob` of parts, so an export never holds the whole file in one buffer.
 *
 * Sources with another channel count mix into the plan's by Web Audio's
 * speaker rules, as playback does. Samples are clamped to full scale, and
 * 16-bit and 24-bit PCM round half away from zero, without dither. Files
 * whose sizes don't fit 32 bits are written as RF64.
 *
 * @example
 * ```ts
 * const processor = createAudioProcessor();
 * const wav = await processor.render(
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
  for (const clip of plan.clips) {
    const source = sources.get(clip.source);
    if (!source) throw new TypeError(`Clip ${clip.key}'s source ${clip.source} isn't in the job.`);
    assertClip(clip, source.length);
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
  ): Promise<Blob> {
    const { plan, sources } = job;
    const sampleFormat = check(job);
    throwIfAborted(signal);
    const worker = await ready();
    const call = signal ? { signal } : {};
    const frames = planLength(plan);
    const spec = { sampleRate: plan.sampleRate, channels: plan.channels, frames, sampleFormat };
    const parts: Uint8Array<ArrayBuffer>[] = [
      await worker.call("wavHeader", { ...spec, metadata: { ...plan.metadata } }, call),
    ];
    const offsets = clipOffsets(plan);
    // The first clip that can overlap the next block, so each block looks
    // only at its own clips.
    let first = 0;
    for (let start = 0; start < frames; start += EXPORT_BLOCK_FRAMES) {
      throwIfAborted(signal);
      const length = Math.min(EXPORT_BLOCK_FRAMES, frames - start);
      const end = start + length;
      const segments: BlockSegment[] = [];
      while (first < plan.clips.length) {
        const clip = plan.clips[first];
        if (!clip || (offsets[first] as number) + clipLength(clip) > start) break;
        first += 1;
      }
      for (let index = first; index < plan.clips.length; index += 1) {
        const clip = plan.clips[index];
        const offset = offsets[index] as number;
        if (!clip || offset >= end) break;
        const from = Math.max(start, offset);
        const to = Math.min(end, offset + clipLength(clip));
        const within = from - offset;
        const source = sources.get(clip.source);
        if (!source) throw new TypeError(`Clip ${clip.key}'s source isn't in the job.`);
        const samples = Array.from({ length: source.numberOfChannels }, (_, channel) =>
          source
            .getChannelData(channel)
            .slice(clip.start + within, clip.start + within + (to - from)),
        );
        segments.push({ clip, within, at: from - start, samples, frames: to - from });
      }
      parts.push(
        await worker.call(
          "renderBlock",
          { channels: plan.channels, frames: length, sampleFormat, segments },
          call,
        ),
      );
      onProgress?.(end / frames);
    }
    // Chunks are padded to an even size.
    if (dataSize(spec) % 2 === 1) parts.push(new Uint8Array(1));
    if (frames === 0) onProgress?.(1);
    return new Blob(parts, { type: "audio/wav" });
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
