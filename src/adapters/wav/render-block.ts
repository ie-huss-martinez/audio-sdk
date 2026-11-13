import { gainAt } from "../../core/model/envelope.js";
import { channelMix } from "../../core/model/mix.js";
import type { AudioClip } from "../../core/model/plan.js";
import type { AudioSampleFormat } from "../../core/ports/audio-processor.js";
import { encodeSamples } from "./wav-writer.js";

/**
 * One clip's part of an output block: its source samples for the frames it
 * covers there, one array per source channel.
 */
export interface BlockSegment {
  /** The clip, for its gain and fades. */
  readonly clip: AudioClip;
  /** The first frame, counted from the clip's start. */
  readonly within: number;
  /** The frame of the block the segment starts at. */
  readonly at: number;
  /** The source's samples, one array per source channel, each `frames` long. */
  readonly samples: readonly Float32Array[];
  readonly frames: number;
}

/** One output block to render and encode. */
export interface RenderBlockInput {
  /** The plan's channel count. */
  readonly channels: number;
  /** The block's length in frames. */
  readonly frames: number;
  readonly sampleFormat: AudioSampleFormat;
  readonly segments: readonly BlockSegment[];
}

/**
 * Renders one output block (docs/adr/0003): each segment's samples, mixed
 * to the plan's channels by Web Audio's speaker rules, times the clip's
 * `gainAt` at each frame, then clamped, quantised and interleaved as WAV
 * samples. Frames no segment covers are silent.
 */
export function renderBlock(input: RenderBlockInput): Uint8Array<ArrayBuffer> {
  const { channels, frames, sampleFormat, segments } = input;
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  const mixed = new Float64Array(channels);
  for (const segment of segments) {
    const matrix = channelMix(segment.samples.length, channels);
    for (let i = 0; i < segment.frames; i += 1) {
      const gain = gainAt(segment.clip, segment.within + i);
      mixed.fill(0);
      for (let input = 0; input < segment.samples.length; input += 1) {
        const sample = (segment.samples[input] as Float32Array)[i] as number;
        for (let output = 0; output < channels; output += 1) {
          mixed[output] =
            (mixed[output] as number) + ((matrix[output] as number[])[input] as number) * sample;
        }
      }
      for (let output = 0; output < channels; output += 1) {
        (out[output] as Float32Array)[segment.at + i] = (mixed[output] as number) * gain;
      }
    }
  }
  return encodeSamples(out, frames, sampleFormat);
}
