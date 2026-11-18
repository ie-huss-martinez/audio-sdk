import { throwIfAborted } from "../../src/core/errors/abort.js";
import { assertClip } from "../../src/core/model/plan.js";
import {
  type AudioMetadata,
  type AudioProcessor,
  type AudioSampleFormat,
  audibleTracks,
  clipAt,
  dbToGain,
  gainAt,
  mixLength,
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
      for (const clip of plan.tracks.flatMap((track) => track.clips)) {
        const source = sources.get(clip.source);
        if (!source)
          throw new TypeError(`Clip ${clip.key}'s source ${clip.source} isn't in the job.`);
        assertClip(clip, source.length);
      }

      // Frame by frame, as the mix is defined: the sum over the audible
      // tracks of each one's clip at that frame, then the master gain.
      const frames = mixLength(plan);
      const tracks = audibleTracks(plan);
      const master = dbToGain(plan.gainDb);
      const output = Array.from({ length: plan.channels }, () => new Array<number>(frames));
      let peak = 0;
      let clippedFrames = 0;
      for (let frame = 0; frame < frames; frame += 1) {
        if (frame % 64 === 0) {
          await Promise.resolve();
          throwIfAborted(options.signal);
        }
        let over = false;
        for (let c = 0; c < plan.channels; c += 1) {
          let sum = 0;
          for (const track of tracks) {
            const clip = clipAt(track, frame);
            const source = clip && sources.get(clip.source);
            if (!clip || !source) continue;
            const from = sourceChannel(c, source.numberOfChannels);
            if (from === undefined) continue;
            const within = frame - clip.at;
            const sample = source.getChannelData(from)[clip.start + within] ?? 0;
            sum += sample * gainAt(clip, within) * dbToGain(track.gainDb);
          }
          const value = sum * master;
          peak = Math.max(peak, Math.abs(value));
          if (Math.abs(value) > 1) over = true;
          (output[c] as number[])[frame] = quantise(value, sampleFormat);
        }
        if (over) clippedFrames += 1;
        options.onProgress?.((frame + 1) / frames);
      }
      if (frames === 0) options.onProgress?.(1);

      const wav: FakeWav = {
        sampleRate: plan.sampleRate,
        sampleFormat,
        metadata: plan.metadata,
        samples: output,
      };
      return {
        blob: new Blob([MAGIC, JSON.stringify(wav)], { type: "audio/wav" }),
        peakDb: 20 * Math.log10(peak),
        clippedFrames,
      };
    },
    async destroy() {
      destroyed = true;
    },
  };
}
