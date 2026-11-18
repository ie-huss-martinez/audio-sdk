import type { AudioPeakLevel, AudioPeaks } from "./source.js";

/**
 * The lowest and highest sample of each column of a waveform, over every
 * channel, as {@link peakColumns} gives them.
 *
 * @public
 */
export interface AudioPeakColumns {
  readonly min: Float32Array<ArrayBuffer>;
  readonly max: Float32Array<ArrayBuffer>;
}

/**
 * Options for {@link peakColumns}: the source frames to draw, and how many
 * columns to draw them in.
 *
 * @public
 */
export interface AudioPeakColumnsOptions {
  /** The first source frame, inclusive. */
  readonly from: number;
  /** The source frame to stop before. */
  readonly to: number;
  /** How many columns, such as device pixels, a whole number from 1. */
  readonly columns: number;
}

/**
 * The level to draw from: the coarsest whose buckets are no wider than a
 * column, so every column has at least one bucket of its own, and the
 * finest when columns are narrower than its buckets.
 */
function levelFor(peaks: AudioPeaks, framesPerColumn: number): AudioPeakLevel | undefined {
  let chosen: AudioPeakLevel | undefined;
  for (const level of peaks.levels) {
    if (level.framesPerBucket <= framesPerColumn) chosen = level;
  }
  return chosen ?? peaks.levels[0];
}

/**
 * A waveform's columns, drawn from a source's peaks, never from its samples
 * (point 13 of #54, docs/adr/0005): for each of `columns` equal parts of the
 * source frames from `from` to `to`, the lowest and highest sample of every
 * channel, from the level of the overview whose buckets best fit a column.
 * Levels step by four, so a column reads at most a few buckets, and drawing
 * costs the same for an hour as for a minute. Frames past the source's end
 * are silent, 0.
 *
 * @throws `RangeError` for frames that aren't whole numbers from 0 with
 *   `from` before `to`, or `columns` that isn't a whole number from 1.
 * @public
 */
export function peakColumns(peaks: AudioPeaks, options: AudioPeakColumnsOptions): AudioPeakColumns {
  const { from, to, columns } = options;
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from) {
    throw new RangeError("from and to are whole frames, with from at 0 or more and before to.");
  }
  if (!Number.isSafeInteger(columns) || columns < 1) {
    throw new RangeError("columns is a whole number from 1.");
  }
  const min = new Float32Array(columns);
  const max = new Float32Array(columns);
  const framesPerColumn = (to - from) / columns;
  const level = levelFor(peaks, framesPerColumn);
  if (!level) return { min, max };
  const { framesPerBucket, channels } = level;
  const buckets = channels[0]?.min.length ?? 0;
  for (let column = 0; column < columns; column += 1) {
    const start = from + column * framesPerColumn;
    const end = from + (column + 1) * framesPerColumn;
    const first = Math.floor(start / framesPerBucket);
    // At least the bucket the column starts in, when columns are narrower.
    const last = Math.min(buckets, Math.max(first + 1, Math.ceil(end / framesPerBucket)));
    let low = 0;
    let high = 0;
    for (const channel of channels) {
      for (let bucket = first; bucket < last; bucket += 1) {
        low = Math.min(low, channel.min[bucket] as number);
        high = Math.max(high, channel.max[bucket] as number);
      }
    }
    min[column] = low;
    max[column] = high;
  }
  return { min, max };
}
