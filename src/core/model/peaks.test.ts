import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { peakColumns } from "./peaks.js";
import type { AudioPeakLevel, AudioPeaks } from "./source.js";

/** A pyramid built from samples, four buckets per level, as the engine builds one. */
function pyramid(channels: readonly number[][], finest = 2): AudioPeaks {
  const levels: AudioPeakLevel[] = [];
  for (let bucket = finest; ; bucket *= 4) {
    const count = Math.ceil((channels[0]?.length ?? 0) / bucket);
    levels.push({
      framesPerBucket: bucket,
      channels: channels.map((samples) => {
        const min = new Float32Array(count);
        const max = new Float32Array(count);
        for (let i = 0; i < count; i += 1) {
          const part = samples.slice(i * bucket, (i + 1) * bucket);
          min[i] = Math.min(...part);
          max[i] = Math.max(...part);
        }
        return { min, max };
      }),
    });
    if (count <= 1) break;
  }
  return { levels };
}

describe("peakColumns", () => {
  const left = Array.from({ length: 128 }, (_, i) => Math.sin(i / 3) * 0.5);
  const right = left.map((sample, i) => (i % 2 === 0 ? -sample : sample * 0.2));
  const peaks = pyramid([left, right]);

  it("gives each column the extremes of every channel over its frames", () => {
    const { min, max } = peakColumns(peaks, { from: 0, to: 128, columns: 4 });
    for (let column = 0; column < 4; column += 1) {
      const part = [...left, ...right].filter((_, i) => {
        const frame = i % 128;
        return frame >= column * 32 && frame < (column + 1) * 32;
      });
      expect(min[column]).toBeCloseTo(Math.min(0, ...part), 6);
      expect(max[column]).toBeCloseTo(Math.max(0, ...part), 6);
    }
  });

  it("never misses an extreme, and reads only a few buckets a column, at any zoom", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 127 }),
        fc.integer({ min: 1, max: 128 }),
        fc.integer({ min: 1, max: 200 }),
        (from, span, columns) => {
          const to = Math.min(128, from + span);
          fc.pre(to > from);
          const { min, max } = peakColumns(peaks, { from, to, columns });
          const part = [...left.slice(from, to), ...right.slice(from, to)];
          // Columns may reach a bucket past their frames, never miss one.
          expect(Math.min(...min)).toBeLessThanOrEqual(Math.min(0, ...part) + 1e-6);
          expect(Math.max(...max)).toBeGreaterThanOrEqual(Math.max(0, ...part) - 1e-6);
        },
      ),
    );
  });

  it("chooses the coarsest level whose buckets fit in a column", () => {
    // 128 frames in 2 columns: 64 a column, so the 32-frame level, not the 128.
    const level = pyramid([left]);
    const coarse = peakColumns(level, { from: 0, to: 128, columns: 2 });
    expect(coarse.max[0]).toBeCloseTo(Math.max(...left.slice(0, 64)), 6);
    // More columns than frames: the finest level, each column at least one bucket.
    const fine = peakColumns(level, { from: 10, to: 12, columns: 8 });
    expect(fine.max.every((value) => value >= 0)).toBe(true);
  });

  it("is silent past the source's end, and refuses ranges and counts that aren't whole", () => {
    const { min, max } = peakColumns(peaks, { from: 128, to: 256, columns: 4 });
    expect([...min, ...max]).toEqual(new Array(8).fill(0));
    for (const options of [
      { from: -1, to: 10, columns: 1 },
      { from: 10, to: 10, columns: 1 },
      { from: 0, to: 10.5, columns: 1 },
      { from: 0, to: 10, columns: 0 },
      { from: 0, to: 10, columns: 1.5 },
    ]) {
      expect(() => peakColumns(peaks, options)).toThrow(RangeError);
    }
    expect(peakColumns({ levels: [] }, { from: 0, to: 10, columns: 2 }).max).toEqual(
      new Float32Array(2),
    );
  });
});
