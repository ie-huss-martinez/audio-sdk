import { gainAt } from "../../core/model/envelope.js";
import { type AudioClip, clipLength } from "../../core/model/plan.js";

/**
 * The most points a fade's curve gets: Web Audio interpolates linearly
 * between them, so a long fade is sampled, and a short one is exact.
 */
export const MAX_CURVE_POINTS = 1_024;

/** One automation event of a clip's `GainNode`, in seconds from when the clip starts playing. */
export type GainEvent =
  | { readonly kind: "set"; readonly time: number; readonly value: number }
  | {
      readonly kind: "curve";
      readonly time: number;
      readonly duration: number;
      readonly values: Float32Array;
    };

/** Samples `gainAt` from frame `from` to frame `to`, both included, at no more than the maximum points. */
function curve(clip: AudioClip, from: number, to: number): Float32Array {
  const points = Math.min(MAX_CURVE_POINTS, to - from + 1);
  const values = new Float32Array(points);
  for (let i = 0; i < points; i += 1) {
    const frame = points === 1 ? from : from + ((to - from) * i) / (points - 1);
    values[i] = gainAt(clip, Math.round(frame));
  }
  return values;
}

/**
 * A clip's gain automation, played from frame `from` of the clip, as
 * `setValueAtTime` and `setValueCurveAtTime` events (docs/adr/0001): the
 * playback side of `gainAt`, which export applies per sample.
 *
 * - **Fade in:** a curve from `from` to the fade's last frame, then the
 *   clip's gain.
 * - **Fade out:** a curve from its first frame to the clip's last, reaching
 *   silence there.
 * - **No two events share a time,** and no event falls inside a curve, which
 *   Web Audio refuses: a fade out that starts where the fade in ends follows
 *   its curve directly.
 */
export function gainEvents(clip: AudioClip, from: number, sampleRate: number): GainEvent[] {
  const length = clipLength(clip);
  const fadeInEnd = clip.fadeIn.frames;
  const fadeOutStart = length - clip.fadeOut.frames;
  const at = (frame: number) => (frame - from) / sampleRate;
  const events: GainEvent[] = [];
  let cursor = from;

  if (from < fadeInEnd) {
    // Its last value, the clip's steady gain, holds after it.
    events.push({
      kind: "curve",
      time: 0,
      duration: at(fadeInEnd),
      values: curve(clip, from, fadeInEnd),
    });
    cursor = fadeInEnd;
  }
  const outFrom = Math.max(cursor, fadeOutStart);
  const fadingOut = clip.fadeOut.frames > 0 && outFrom < length - 1;
  // The steady gain from the start, unless a curve starts there.
  if (events.length === 0 && !(fadingOut && outFrom === from)) {
    events.push({ kind: "set", time: 0, value: gainAt(clip, from) });
  }
  if (fadingOut) {
    events.push({
      kind: "curve",
      time: at(outFrom),
      duration: at(length - 1) - at(outFrom),
      values: curve(clip, outFrom, length - 1),
    });
  } else if (clip.fadeOut.frames > 0 && outFrom > cursor) {
    // A fade out of the last frame alone, too short for a curve: silence there.
    events.push({ kind: "set", time: at(outFrom), value: gainAt(clip, outFrom) });
  }
  return events;
}
