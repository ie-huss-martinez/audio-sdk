/**
 * Reads a timecode as the editor writes it, `0:12.40` or `1:02:05.00`, or
 * plain seconds, as `12.4`, into frames, rounded to the nearest. Spaces
 * around it are ignored. Anything else is `undefined`, so a field goes back
 * to its value.
 *
 * @internal
 */
export function parseTimecode(text: string, sampleRate: number): number | undefined {
  const match = /^(?:(?:(\d+):)?(\d+):)?(\d+(?:\.\d*)?|\.\d+)$/.exec(text.trim());
  if (!match) return undefined;
  const [, hours, minutes, seconds] = match;
  // Below an hour or a minute, the units above it can't run over.
  if (
    (minutes !== undefined && Number(seconds) >= 60) ||
    (hours !== undefined && Number(minutes) >= 60)
  ) {
    return undefined;
  }
  const total = Number(hours ?? 0) * 3_600 + Number(minutes ?? 0) * 60 + Number(seconds);
  return Number.isFinite(total) ? Math.round(total * sampleRate) : undefined;
}
