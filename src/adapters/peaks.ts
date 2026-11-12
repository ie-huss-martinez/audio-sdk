import type { AudioPeakLevel, AudioPeaks } from "../core/model/source.js";

/**
 * Frames per bucket at the finest level of a waveform overview. Each coarser
 * level groups four buckets of the one before (docs/adr/0002).
 *
 * @internal
 */
export const FINEST_BUCKET = 256;

/** How many buckets each coarser level combines. */
const LEVEL_FACTOR = 4;

/** Each channel's minimum and maximum per bucket. */
export interface BucketPeaks {
  readonly min: Float32Array[];
  readonly max: Float32Array[];
}

/**
 * The minimum and maximum of each bucket of `bucket` frames, per channel.
 * Called on a block whose first frame starts a bucket; a last, shorter
 * bucket covers what's left.
 *
 * @internal
 */
export function blockPeaks(channels: readonly Float32Array[], bucket: number): BucketPeaks {
  const min: Float32Array[] = [];
  const max: Float32Array[] = [];
  for (const samples of channels) {
    const count = Math.ceil(samples.length / bucket);
    const low = new Float32Array(count);
    const high = new Float32Array(count);
    for (let b = 0; b < count; b += 1) {
      const end = Math.min(samples.length, (b + 1) * bucket);
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      for (let i = b * bucket; i < end; i += 1) {
        const sample = samples[i] as number;
        if (sample < lo) lo = sample;
        if (sample > hi) hi = sample;
      }
      low[b] = lo;
      high[b] = hi;
    }
    min.push(low);
    max.push(high);
  }
  return { min, max };
}

/**
 * Builds the whole pyramid from the finest level, each level combining four
 * buckets of the one before, until a level has one bucket.
 *
 * @internal
 */
export function buildPyramid(finest: BucketPeaks, bucket = FINEST_BUCKET): AudioPeaks {
  const levels: AudioPeakLevel[] = [];
  let current = finest;
  let framesPerBucket = bucket;
  for (;;) {
    levels.push({
      framesPerBucket,
      channels: current.min.map((min, c) => ({ min, max: current.max[c] as Float32Array })),
    });
    const count = current.min[0]?.length ?? 0;
    if (count <= 1) break;
    current = {
      min: current.min.map((values) => combine(values, Math.min)),
      max: current.max.map((values) => combine(values, Math.max)),
    };
    framesPerBucket *= LEVEL_FACTOR;
  }
  return { levels };
}

function combine(values: Float32Array, pick: (a: number, b: number) => number): Float32Array {
  const out = new Float32Array(Math.ceil(values.length / LEVEL_FACTOR));
  for (let i = 0; i < out.length; i += 1) {
    let value = values[i * LEVEL_FACTOR] as number;
    const end = Math.min(values.length, (i + 1) * LEVEL_FACTOR);
    for (let j = i * LEVEL_FACTOR + 1; j < end; j += 1) value = pick(value, values[j] as number);
    out[i] = value;
  }
  return out;
}
