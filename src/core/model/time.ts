/**
 * Every position and length in the model is a whole number of frames, at the
 * session's sample rate (ADR 0003). A frame is one sample on every channel.
 * Seconds appear only at the edges: in the UI and in events.
 */

/**
 * Converts frames to seconds, for display and events.
 *
 * @param frames - A whole number of frames.
 * @param sampleRate - Frames per second.
 * @public
 */
export function framesToSeconds(frames: number, sampleRate: number): number {
  return frames / sampleRate;
}

/**
 * Converts seconds to the nearest whole frame, for input from the UI, such
 * as a typed trim point.
 *
 * @param seconds - A time in seconds.
 * @param sampleRate - Frames per second.
 * @public
 */
export function secondsToFrames(seconds: number, sampleRate: number): number {
  return Math.round(seconds * sampleRate);
}

/**
 * Throws `RangeError` unless the value is a non-negative whole number of
 * frames.
 *
 * @internal
 */
export function assertFrames(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative whole number of frames, not ${value}.`);
  }
}
