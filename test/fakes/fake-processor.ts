import { throwIfAborted } from "../../src/core/errors/abort.js";
import { assertClip } from "../../src/core/model/plan.js";
import {
  type AudioMetadata,
  type AudioProcessor,
  type AudioSampleFormat,
  clipLength,
  gainAt,
  planLength,
} from "../../src/index.js";

/** What the fake processor writes: JSON, standing in for a WAV file. */
export interface FakeWav {
  readonly sampleRate: number;
  readonly sampleFormat: AudioSampleFormat;
  readonly metadata: AudioMetadata;
  /** Samples per channel, as stored: integers for PCM, floats for float32. */
  readonly samples: readonly (readonly number[])[];
}

const MAGIC = "FAKEWAV1";

export async function readFakeWav(blob: Blob): Promise<FakeWav> {
  const text = await blob.text();
  if (!text.startsWith(MAGIC)) throw new Error("Not a fake WAV.");
  return JSON.parse(text.slice(MAGIC.length)) as FakeWav;
}

function quantise(sample: number, format: AudioSampleFormat): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  if (format === "float32") return Math.fround(clamped);
  const bits = format === "pcm16" ? 16 : 24;
  const negative = 2 ** (bits - 1);
  return Math.round(clamped < 0 ? clamped * negative : clamped * (negative - 1));
}

/** Reads a stored sample back as a float, as a WAV reader would. */
export function dequantise(value: number, format: AudioSampleFormat): number {
  if (format === "float32") return value;
  const bits = format === "pcm16" ? 16 : 24;
  const negative = 2 ** (bits - 1);
  return value < 0 ? value / negative : value / (negative - 1);
}

/**
 * Which source channel feeds an output channel, mono feeding every channel,
 * as in Web Audio's speaker rules for the layouts the fakes need (ADR 0003).
 */
function sourceChannel(output: number, sourceChannels: number): number | undefined {
  if (sourceChannels === 1) return 0;
  return output < sourceChannels ? output : undefined;
}

/** An in-memory processor that renders exactly as the real one must. */
export function createFakeProcessor(): AudioProcessor {
  let destroyed = false;
  return {
    async render(job, options = {}) {
      if (destroyed) throw new Error("The processor has been destroyed.");
      throwIfAborted(options.signal);
      const { plan, sources, format } = job;
      const sampleFormat = format.sampleFormat ?? "pcm16";
      for (const clip of plan.clips) {
        const source = sources.get(clip.source);
        if (!source)
          throw new TypeError(`Clip ${clip.key}'s source ${clip.source} isn't in the job.`);
        assertClip(clip, source.length);
      }

      const output = Array.from(
        { length: plan.channels },
        () => new Array<number>(planLength(plan)),
      );
      let at = 0;
      for (const [index, clip] of plan.clips.entries()) {
        await Promise.resolve();
        throwIfAborted(options.signal);
        const source = sources.get(clip.source);
        if (!source) throw new TypeError("unreachable");
        const length = clipLength(clip);
        for (let c = 0; c < plan.channels; c += 1) {
          const from = sourceChannel(c, source.numberOfChannels);
          const data = from === undefined ? undefined : source.getChannelData(from);
          const target = output[c] as number[];
          for (let i = 0; i < length; i += 1) {
            const sample = data ? (data[clip.start + i] ?? 0) : 0;
            target[at + i] = quantise(sample * gainAt(clip, i), sampleFormat);
          }
        }
        at += length;
        options.onProgress?.((index + 1) / plan.clips.length);
      }
      if (plan.clips.length === 0) options.onProgress?.(1);

      const wav: FakeWav = {
        sampleRate: plan.sampleRate,
        sampleFormat,
        metadata: plan.metadata,
        samples: output,
      };
      return new Blob([MAGIC, JSON.stringify(wav)], { type: "audio/wav" });
    },
    async destroy() {
      destroyed = true;
    },
  };
}
