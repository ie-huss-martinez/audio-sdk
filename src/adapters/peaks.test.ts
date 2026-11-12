import { describe, expect, it } from "vitest";
import { blockPeaks, buildPyramid } from "./peaks.js";

describe("blockPeaks", () => {
  it("finds each bucket's minimum and maximum, per channel, with a short last bucket", () => {
    const left = Float32Array.from([0, 0.5, -0.25, 1, -1, 0.2, 0.3]);
    const right = left.map((sample) => -sample);
    const { min, max } = blockPeaks([left, right], 3);
    expect([...(min[0] ?? [])]).toEqual([-0.25, -1, 0.30000001192092896]);
    expect([...(max[0] ?? [])]).toEqual([0.5, 1, 0.30000001192092896]);
    expect([...(max[1] ?? [])]).toEqual([0.25, 1, -0.30000001192092896]);
  });
});

describe("buildPyramid", () => {
  it("combines four buckets per level until one is left", () => {
    const finest = {
      min: [Float32Array.from([-1, 0, 0, 0, 0, -0.5, 0, 0, 0, -0.25])],
      max: [Float32Array.from([0, 0, 0.75, 0, 0, 0, 0, 0, 0.5, 0])],
    };
    const { levels } = buildPyramid(finest, 256);
    expect(levels.map((level) => level.framesPerBucket)).toEqual([256, 1_024, 4_096]);
    expect([...(levels[1]?.channels[0]?.min ?? [])]).toEqual([-1, -0.5, -0.25]);
    expect([...(levels[1]?.channels[0]?.max ?? [])]).toEqual([0.75, 0, 0.5]);
    expect([...(levels[2]?.channels[0]?.min ?? [])]).toEqual([-1]);
    expect([...(levels[2]?.channels[0]?.max ?? [])]).toEqual([0.75]);
  });

  it("has a single level for audio of one bucket", () => {
    const { levels } = buildPyramid({ min: [Float32Array.of(-0.1)], max: [Float32Array.of(0.1)] });
    expect(levels).toHaveLength(1);
  });
});
