import { sequenceOffsets } from "@hussmartinez/sdk-core";
import { assertFrames } from "./time.js";

/**
 * The shape of a fade: `linear` changes the gain at a constant rate, and
 * `equalPower` keeps the perceived loudness steadier, which suits crossfades.
 *
 * @public
 */
export type AudioFadeCurve = "linear" | "equalPower";

/**
 * A fade at one end of a clip. `frames: 0` is no fade.
 *
 * @public
 */
export interface AudioFade {
  readonly frames: number;
  readonly curve: AudioFadeCurve;
}

/**
 * One piece of a source, played in the plan (ADR 0003).
 *
 * @public
 */
export interface AudioClip {
  /** Stable across edits, so selection and waveform tiles follow a clip that moves. */
  readonly key: string;
  /** The id of the source the clip plays. */
  readonly source: string;
  /** The first source frame the clip plays, inclusive. */
  readonly start: number;
  /** The source frame the clip stops before, exclusive. */
  readonly end: number;
  /** The clip's gain in decibels. 0 leaves it unchanged. */
  readonly gainDb: number;
  readonly fadeIn: AudioFade;
  readonly fadeOut: AudioFade;
}

/**
 * Metadata that export writes into the file (ADR 0001).
 *
 * @public
 */
export interface AudioMetadata {
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly year: string;
  readonly comment: string;
}

/**
 * The session's document: clips played back to back on one track, over
 * immutable sources, with the metadata (ADR 0003). Every position and length
 * is a whole number of frames at `sampleRate`.
 *
 * @public
 */
export interface AudioPlan {
  /** The session's sample rate, from its first source. */
  readonly sampleRate: number;
  /** The session's channel count, from its first source. */
  readonly channels: number;
  readonly clips: readonly AudioClip[];
  readonly metadata: AudioMetadata;
}

/**
 * Metadata with every field empty.
 *
 * @public
 */
export const EMPTY_METADATA: AudioMetadata = Object.freeze({
  title: "",
  artist: "",
  album: "",
  year: "",
  comment: "",
});

/**
 * No fade.
 *
 * @public
 */
export const NO_FADE: AudioFade = Object.freeze({ frames: 0, curve: "linear" });

/**
 * A clip's length in frames.
 *
 * @public
 */
export function clipLength(clip: AudioClip): number {
  return clip.end - clip.start;
}

/**
 * The plan's length in frames: the sum of its clips' lengths.
 *
 * @public
 */
export function planLength(plan: AudioPlan): number {
  let total = 0;
  for (const clip of plan.clips) total += clipLength(clip);
  return total;
}

/**
 * Where each clip starts on the timeline, in frames. It's derived from the
 * clips before it, never stored, so it can't disagree with them (ADR 0003).
 *
 * @public
 */
export function clipOffsets(plan: AudioPlan): readonly number[] {
  return clipBoundaries(plan).slice(0, -1);
}

/**
 * Every clip boundary on the timeline, in frames: the clips' starts, then
 * the plan's length (sdk-core ADR 0042).
 *
 * @internal
 */
export function clipBoundaries(plan: AudioPlan): readonly number[] {
  return sequenceOffsets(plan.clips.map(clipLength));
}

/**
 * Throws `RangeError` unless the clip is well formed within a source of
 * `sourceFrames` frames: whole, non-negative frames, at least one frame
 * long, inside the source, with a finite gain and fades that fit the clip
 * together.
 *
 * @internal
 */
export function assertClip(clip: AudioClip, sourceFrames: number): void {
  assertFrames("start", clip.start);
  assertFrames("end", clip.end);
  assertFrames("fadeIn.frames", clip.fadeIn.frames);
  assertFrames("fadeOut.frames", clip.fadeOut.frames);
  if (clip.end <= clip.start) {
    throw new RangeError(`Clip ${clip.key} must be at least one frame long.`);
  }
  if (clip.end > sourceFrames) {
    throw new RangeError(`Clip ${clip.key} ends after its source's ${sourceFrames} frames.`);
  }
  if (!Number.isFinite(clip.gainDb)) {
    throw new RangeError(`Clip ${clip.key} has a gain that isn't a finite number.`);
  }
  if (clip.fadeIn.frames + clip.fadeOut.frames > clipLength(clip)) {
    throw new RangeError(`Clip ${clip.key}'s fades are longer than the clip.`);
  }
}
