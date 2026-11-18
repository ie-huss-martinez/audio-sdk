import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { resampleBlock, resampledLength, resampleReach } from "./resample.js";

/** A tone of `hertz` at `rate`, at half scale. */
const tone = (hertz: number, rate: number, frames: number) =>
  Float32Array.from({ length: frames }, (_, i) => Math.sin((2 * Math.PI * hertz * i) / rate) / 2);

/** Converts a whole channel in one block. */
const convert = (input: Float32Array, fromRate: number, toRate: number) =>
  resampleBlock({
    input,
    inputStart: 0,
    fromRate,
    toRate,
    start: 0,
    frames: resampledLength(input.length, fromRate, toRate),
  });

/** The loudest sample away from the ends, which fade into silence. */
function peak(samples: Float32Array, margin: number): number {
  let most = 0;
  for (let i = margin; i < samples.length - margin; i += 1) {
    most = Math.max(most, Math.abs(samples[i] as number));
  }
  return most;
}

describe("resampledLength", () => {
  it("covers the same time, rounded up", () => {
    expect(resampledLength(44_100, 44_100, 48_000)).toBe(48_000);
    expect(resampledLength(30, 12_000, 8_000)).toBe(20);
    expect(resampledLength(1, 48_000, 44_100)).toBe(1);
    expect(resampledLength(0, 48_000, 44_100)).toBe(0);
  });

  it("refuses rates and lengths that aren't whole", () => {
    for (const [frames, from, to] of [
      [-1, 8_000, 8_000],
      [10, 0, 8_000],
      [10, 8_000, 0.5],
      [Number.NaN, 8_000, 8_000],
    ] as const) {
      expect(() => resampledLength(frames, from, to)).toThrow(RangeError);
    }
  });
});

describe("resampleBlock", () => {
  it("keeps a tone's pitch and level, up and down", () => {
    for (const [from, to] of [
      [44_100, 48_000],
      [48_000, 44_100],
      [22_050, 48_000],
      [96_000, 44_100],
    ] as const) {
      const output = convert(tone(1_000, from, from / 10), from, to);
      const expected = tone(1_000, to, output.length);
      const margin = resampleReach(from, to) * 2;
      for (let i = margin; i < output.length - margin; i += 1) {
        expect(Math.abs((output[i] as number) - (expected[i] as number))).toBeLessThan(1e-4);
      }
    }
  });

  it("keeps a steady level, and rings only a little where the recording starts and ends", () => {
    const output = convert(new Float32Array(2_000).fill(0.5), 44_100, 48_000);
    for (let i = 100; i < output.length - 100; i += 1) {
      expect(output[i]).toBeCloseTo(0.5, 6);
    }
    // A recording that starts at full level is a step, which a band-limited
    // signal overshoots by about a tenth.
    expect(peak(output, 0)).toBeLessThan(0.5 * 1.15);
  });

  it("removes what the lower rate can't carry, instead of folding it back", () => {
    // 15 kHz is above 8 kHz's Nyquist frequency: nothing of it may remain.
    const high = convert(tone(15_000, 48_000, 9_600), 48_000, 8_000);
    expect(peak(high, 40)).toBeLessThan(0.5 * 1e-4);
    // 2 kHz is below it, and passes.
    const low = convert(tone(2_000, 48_000, 9_600), 48_000, 8_000);
    expect(peak(low, 40)).toBeGreaterThan(0.499);
  });

  it("gives the same samples however the output is cut into blocks", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 400 }),
        fc.constantFrom(8_000, 11_025, 44_100, 48_000, 44_101),
        fc.constantFrom(8_000, 22_050, 44_100, 48_000, 96_000),
        fc.integer({ min: 1, max: 97 }),
        (frames, fromRate, toRate, blockFrames) => {
          const input = Float32Array.from({ length: frames }, (_, i) => Math.sin(i * 0.7) - 0.2);
          const whole = convert(input, fromRate, toRate);
          expect(whole.every(Number.isFinite)).toBe(true);
          for (let start = 0; start < whole.length; start += blockFrames) {
            const count = Math.min(blockFrames, whole.length - start);
            // Only the input each block needs, as the engine sends it.
            const reach = resampleReach(fromRate, toRate);
            const first = Math.max(0, Math.floor((start * fromRate) / toRate) - reach);
            const end = Math.floor(((start + count) * fromRate) / toRate) + reach + 1;
            const block = resampleBlock({
              input: input.slice(first, end),
              inputStart: first,
              fromRate,
              toRate,
              start,
              frames: count,
            });
            expect([...block]).toEqual([...whole.subarray(start, start + count)]);
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it("refuses rates and positions that aren't whole", () => {
    const block = {
      input: new Float32Array(4),
      inputStart: 0,
      fromRate: 8_000,
      toRate: 16_000,
      start: 0,
      frames: 4,
    };
    for (const change of [
      { fromRate: 0 },
      { toRate: -1 },
      { toRate: 44_100.5 },
      { start: -1 },
      { frames: 1.5 },
      { inputStart: Number.NaN },
    ]) {
      expect(() => resampleBlock({ ...block, ...change })).toThrow(RangeError);
    }
  });
});
