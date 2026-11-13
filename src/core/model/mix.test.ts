import { describe, expect, it } from "vitest";
import { channelMix } from "./mix.js";

const h = Math.SQRT1_2;

/** Applies a matrix to one frame. */
const mix = (from: number[], to: number) =>
  channelMix(from.length, to).map((row) =>
    row.reduce((sum, weight, i) => sum + weight * (from[i] as number), 0),
  );

describe("channelMix, as Web Audio's speaker rules", () => {
  // L, R, C, LFE, SL, SR for 5.1; L, R, SL, SR for quad.
  it.each([
    ["mono to stereo", [1], 2, [1, 1]],
    ["mono to quad", [1], 4, [1, 1, 0, 0]],
    ["mono to 5.1, into the centre", [1], 6, [0, 0, 1, 0, 0, 0]],
    ["stereo to quad", [1, 2], 4, [1, 2, 0, 0]],
    ["stereo to 5.1", [1, 2], 6, [1, 2, 0, 0, 0, 0]],
    ["quad to 5.1", [1, 2, 3, 4], 6, [1, 2, 0, 0, 3, 4]],
    ["stereo to mono", [1, 3], 1, [2]],
    ["quad to mono", [1, 2, 3, 4], 1, [2.5]],
    ["5.1 to mono", [1, 2, 3, 4, 5, 6], 1, [h * 3 + 3 + 0.5 * 11]],
    ["quad to stereo", [1, 2, 3, 4], 2, [2, 3]],
    ["5.1 to stereo, dropping the LFE", [1, 2, 3, 4, 5, 6], 2, [1 + h * 8, 2 + h * 9]],
    ["5.1 to quad", [1, 2, 3, 4, 5, 6], 4, [1 + h * 3, 2 + h * 3, 5, 6]],
    ["the same count, unchanged", [1, 2, 3], 3, [1, 2, 3]],
    ["other counts discretely, up", [1, 2, 3], 5, [1, 2, 3, 0, 0]],
    ["other counts discretely, down", [1, 2, 3, 4, 5], 3, [1, 2, 3]],
  ])("mixes %s", (_, input, outputs, expected) => {
    const actual = mix(input, outputs);
    expect(actual).toHaveLength(expected.length);
    for (const [i, value] of actual.entries()) {
      expect(value).toBeCloseTo(expected[i] as number, 12);
    }
  });
});
