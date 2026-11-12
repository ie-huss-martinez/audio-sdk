import type { AudioClip, AudioFadeCurve } from "./plan.js";

/**
 * Converts decibels to a linear gain factor.
 *
 * @public
 */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/** A fade's gain at `position`, from 0 (silent) to 1 (full). */
function fadeShape(curve: AudioFadeCurve, position: number): number {
  return curve === "equalPower" ? Math.sin((position * Math.PI) / 2) : position;
}

/**
 * The gain at one frame of a clip, from its gain and its fades: the single
 * definition of the envelope, which export applies per sample and playback
 * samples into the clip's `GainNode` (ADR 0001).
 *
 * A fade in starts at silence on the clip's first frame, and a fade out
 * reaches silence on its last frame.
 *
 * @param clip - The clip.
 * @param frame - A frame within the clip, from 0 to its length minus one.
 * @public
 */
export function gainAt(clip: AudioClip, frame: number): number {
  const length = clip.end - clip.start;
  let gain = dbToGain(clip.gainDb);
  const { fadeIn, fadeOut } = clip;
  if (fadeIn.frames > 0 && frame < fadeIn.frames) {
    gain *= fadeShape(fadeIn.curve, frame / fadeIn.frames);
  }
  const fromEnd = length - 1 - frame;
  if (fadeOut.frames > 0 && fromEnd < fadeOut.frames) {
    gain *= fadeShape(fadeOut.curve, Math.max(0, fromEnd) / fadeOut.frames);
  }
  return gain;
}
