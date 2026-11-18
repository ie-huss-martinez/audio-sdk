import { dbToGain, gainAt } from "./envelope.js";
import {
  type AudioClipBody,
  type AudioPlan,
  audibleTracks,
  clipEnd,
  clipIndexAt,
  trackLength,
} from "./plan.js";
import type { DecodedAudio } from "./source.js";

/**
 * How a source's channels mix into the plan's, as Web Audio's `speakers`
 * channel interpretation does, so that playback and export agree
 * (docs/adr/0003). Mono, stereo, quad (L, R, SL, SR) and 5.1 (L, R, C, LFE,
 * SL, SR) mix by the Web Audio specification's up-mix and down-mix rules;
 * any other pair of counts mixes discretely: channel by channel, with extra
 * outputs silent and extra inputs dropped.
 *
 * The result is a matrix: `matrix[output][input]` is the weight of input
 * channel `input` in output channel `output`.
 *
 * @see https://webaudio.github.io/web-audio-api/#channel-up-mixing-and-down-mixing
 * @internal
 */
export function channelMix(from: number, to: number): readonly (readonly number[])[] {
  const matrix = Array.from({ length: to }, () => new Array<number>(from).fill(0));
  const set = (output: number, input: number, weight: number) => {
    (matrix[output] as number[])[input] = weight;
  };
  const half = Math.SQRT1_2;
  const key = `${from}>${to}`;
  switch (key) {
    // Up-mixing.
    case "1>2":
      set(0, 0, 1);
      set(1, 0, 1);
      break;
    case "1>4":
      set(0, 0, 1);
      set(1, 0, 1);
      break;
    case "1>6":
      set(2, 0, 1);
      break;
    case "2>4":
    case "2>6":
      set(0, 0, 1);
      set(1, 1, 1);
      break;
    case "4>6":
      set(0, 0, 1);
      set(1, 1, 1);
      set(4, 2, 1);
      set(5, 3, 1);
      break;
    // Down-mixing.
    case "2>1":
      set(0, 0, 0.5);
      set(0, 1, 0.5);
      break;
    case "4>1":
      for (let input = 0; input < 4; input += 1) set(0, input, 0.25);
      break;
    case "6>1":
      set(0, 0, half);
      set(0, 1, half);
      set(0, 2, 1);
      set(0, 4, 0.5);
      set(0, 5, 0.5);
      break;
    case "4>2":
      set(0, 0, 0.5);
      set(0, 2, 0.5);
      set(1, 1, 0.5);
      set(1, 3, 0.5);
      break;
    case "6>2":
      set(0, 0, 1);
      set(0, 2, half);
      set(0, 4, half);
      set(1, 1, 1);
      set(1, 2, half);
      set(1, 5, half);
      break;
    case "6>4":
      set(0, 0, 1);
      set(0, 2, half);
      set(1, 1, 1);
      set(1, 2, half);
      set(2, 4, 1);
      set(3, 5, 1);
      break;
    default:
      // The same count, or a pair the speaker rules don't cover: discrete.
      for (let channel = 0; channel < Math.min(from, to); channel += 1) set(channel, channel, 1);
  }
  return matrix;
}

/**
 * The length of what sounds, in frames: where the last clip on any audible
 * track ends. It's what an export writes, so a muted track never pads the
 * file with silence (docs/adr/0006).
 *
 * @public
 */
export function mixLength(plan: AudioPlan): number {
  let length = 0;
  for (const track of audibleTracks(plan)) length = Math.max(length, trackLength(track));
  return length;
}

/**
 * One clip's part of a block of the mix: its source's samples for the
 * frames it covers there.
 *
 * @internal
 */
export interface MixSegment {
  /** The clip, for its gain and fades. */
  readonly clip: AudioClipBody;
  /** The gain of the clip's track, as a factor. */
  readonly gain: number;
  /** The first frame, counted from the clip's start. */
  readonly within: number;
  /** The frame of the block the segment starts at. */
  readonly at: number;
  /** The source's samples, one array per source channel, each `frames` long. */
  readonly samples: readonly Float32Array[];
  readonly frames: number;
}

/**
 * A block of the mix to compute.
 *
 * @internal
 */
export interface MixBlock {
  /** The plan's channel count. */
  readonly channels: number;
  /** The block's length in frames. */
  readonly frames: number;
  /** The master gain, as a factor. */
  readonly gain: number;
  readonly segments: readonly MixSegment[];
}

/**
 * A mixed block: its samples, clamped to full scale, and what clamping did.
 *
 * @internal
 */
export interface MixedBlock {
  /** One array per channel of the plan. */
  readonly channels: Float32Array<ArrayBuffer>[];
  /** The largest absolute sample before clamping. 1 is full scale. */
  readonly peak: number;
  /** How many frames had a sample over full scale, which was clamped. */
  readonly clipped: number;
}

/**
 * The parts of the plan's audible clips that fall in the frames
 * `[start, start + frames)`, with copies of their source samples: what
 * {@link mixBlock} needs for that block. Tracks are taken in plan order, and
 * muted and unsoloed tracks are left out, so they cost nothing.
 *
 * @throws `TypeError` if a clip's source isn't in `sources`.
 * @internal
 */
export function gatherSegments(
  plan: AudioPlan,
  sources: ReadonlyMap<string, DecodedAudio>,
  start: number,
  frames: number,
): MixSegment[] {
  const end = start + frames;
  const segments: MixSegment[] = [];
  for (const track of audibleTracks(plan)) {
    const gain = dbToGain(track.gainDb);
    for (let index = clipIndexAt(track.clips, start); index < track.clips.length; index += 1) {
      const clip = track.clips[index];
      if (!clip || clip.at >= end) break;
      const from = Math.max(start, clip.at);
      const to = Math.min(end, clipEnd(clip));
      const within = from - clip.at;
      const source = sources.get(clip.source);
      if (!source) throw new TypeError(`Clip ${clip.key}'s source ${clip.source} isn't given.`);
      const samples = Array.from({ length: source.numberOfChannels }, (_, channel) =>
        source.getChannelData(channel).slice(clip.start + within, clip.start + within + to - from),
      );
      segments.push({ clip, gain, within, at: from - start, samples, frames: to - from });
    }
  }
  return segments;
}

/**
 * Mixes one block (docs/adr/0006), the one definition that export follows
 * and playback's graph reproduces:
 *
 * `out = clamp(master × Σ tracks (track gain × clip's gainAt × its source's frame, mixed to the plan's channels))`
 *
 * Tracks sum at unity, in the order given, in double precision, so every
 * engine adds in the same order. Frames no segment covers are silent.
 *
 * @internal
 */
export function mixBlock(block: MixBlock): MixedBlock {
  const { channels, frames, segments } = block;
  const sums = Array.from({ length: channels }, () => new Float64Array(frames));
  for (const segment of segments) {
    const matrix = channelMix(segment.samples.length, channels);
    for (let input = 0; input < segment.samples.length; input += 1) {
      const samples = segment.samples[input] as Float32Array;
      for (let output = 0; output < channels; output += 1) {
        const weight = (matrix[output] as number[])[input] as number;
        if (weight === 0) continue;
        const sum = sums[output] as Float64Array;
        for (let i = 0; i < segment.frames; i += 1) {
          const gain = gainAt(segment.clip, segment.within + i) * segment.gain;
          sum[segment.at + i] =
            (sum[segment.at + i] as number) + weight * (samples[i] as number) * gain;
        }
      }
    }
  }
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  let peak = 0;
  let clipped = 0;
  for (let i = 0; i < frames; i += 1) {
    let over = false;
    for (let channel = 0; channel < channels; channel += 1) {
      const value = ((sums[channel] as Float64Array)[i] as number) * block.gain;
      const size = Math.abs(value);
      if (size > peak) peak = size;
      if (size > 1) over = true;
      (out[channel] as Float32Array)[i] = Math.max(-1, Math.min(1, value));
    }
    if (over) clipped += 1;
  }
  return { channels: out, peak, clipped };
}
