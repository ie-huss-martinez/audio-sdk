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

/**
 * A timeline position as an editor shows it (docs/adr/0005): minutes,
 * seconds and hundredths, as `0:12.40`, with hours from an hour on, as
 * `1:02:05.00` (point 11 of #54). Hundredths are rounded down, so the time
 * shown is never ahead of what's heard. The digits and separators are the
 * same in every locale, as a timecode's are.
 *
 * @param frames - A non-negative whole number of frames.
 * @param sampleRate - Frames per second, a positive whole number.
 * @throws `RangeError` for frames or a rate that aren't whole numbers, or a
 *   rate of 0.
 * @public
 */
export function formatTimecode(frames: number, sampleRate: number): string {
  assertFrames("frames", frames);
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 1) {
    throw new RangeError(`The sample rate must be a positive whole number, not ${sampleRate}.`);
  }
  const hundredths = Math.floor((frames * 100) / sampleRate);
  const two = (value: number) => String(value).padStart(2, "0");
  const fraction = two(hundredths % 100);
  const seconds = Math.floor(hundredths / 100) % 60;
  const minutes = Math.floor(hundredths / 6_000) % 60;
  const hours = Math.floor(hundredths / 360_000);
  return hours > 0
    ? `${hours}:${two(minutes)}:${two(seconds)}.${fraction}`
    : `${minutes}:${two(seconds)}.${fraction}`;
}
