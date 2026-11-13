import { sequenceOffsets } from "@hussmartinez/sdk-core";

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
 * Why a clip isn't valid within its source, as a stable token: a value of
 * `details.reason` on `INVALID_COMMAND` (sdk-core ADR 0045).
 *
 * - `invalid-frames`: a position or fade length isn't a non-negative whole
 *   number of frames.
 * - `clip-too-short`: the clip is shorter than one frame.
 * - `clip-outside-source`: it ends after its source's last frame.
 * - `gain-out-of-range`: the gain isn't a finite number from
 *   {@link MIN_GAIN_DB} to {@link MAX_GAIN_DB}.
 * - `fades-too-long`: its fades together are longer than the clip.
 *
 * @public
 */
export type AudioClipProblem =
  | "invalid-frames"
  | "clip-too-short"
  | "clip-outside-source"
  | "gain-out-of-range"
  | "fades-too-long";

/**
 * The lowest clip gain, in decibels: far below audibility, so it serves as
 * silence.
 *
 * @public
 */
export const MIN_GAIN_DB = -120;

/**
 * The highest clip gain, in decibels: enough to normalize a very quiet
 * recording, while every gain stays a finite factor.
 *
 * @public
 */
export const MAX_GAIN_DB = 120;

const isFrames = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

/**
 * What's wrong with a clip within a source of `sourceFrames` frames, or
 * `undefined` if it's valid: whole, non-negative frames, at least one frame
 * long, inside the source, with a gain in range and fades that fit the clip
 * together.
 *
 * @internal
 */
export function clipProblem(clip: AudioClip, sourceFrames: number): AudioClipProblem | undefined {
  if (![clip.start, clip.end, clip.fadeIn.frames, clip.fadeOut.frames].every(isFrames)) {
    return "invalid-frames";
  }
  if (clip.end <= clip.start) return "clip-too-short";
  if (clip.end > sourceFrames) return "clip-outside-source";
  if (
    typeof clip.gainDb !== "number" ||
    !(clip.gainDb >= MIN_GAIN_DB && clip.gainDb <= MAX_GAIN_DB)
  ) {
    return "gain-out-of-range";
  }
  if (clip.fadeIn.frames + clip.fadeOut.frames > clipLength(clip)) return "fades-too-long";
  return undefined;
}

/**
 * Throws `RangeError` unless the clip is valid within a source of
 * `sourceFrames` frames, as {@link clipProblem} checks.
 *
 * @internal
 */
export function assertClip(clip: AudioClip, sourceFrames: number): void {
  const problem = clipProblem(clip, sourceFrames);
  if (problem) throw new RangeError(`Clip ${clip.key} isn't valid: ${problem}.`);
}
