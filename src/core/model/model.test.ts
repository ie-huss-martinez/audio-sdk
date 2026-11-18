import { describe, expect, it } from "vitest";
import { dbToGain, gainAt } from "./envelope.js";
import { type AudioClipBody, assertClip, clipLength, clipProblem, NO_FADE } from "./plan.js";
import { assertFrames, framesToSeconds, secondsToFrames } from "./time.js";

function clip(overrides: Partial<AudioClipBody> = {}): AudioClipBody {
  return {
    key: "c",
    source: "s",
    start: 0,
    end: 100,
    gainDb: 0,
    fadeIn: NO_FADE,
    fadeOut: NO_FADE,
    ...overrides,
  };
}

describe("time", () => {
  it("converts between frames and seconds, rounding to the nearest frame", () => {
    expect(framesToSeconds(96_000, 48_000)).toBe(2);
    expect(secondsToFrames(1.5, 44_100)).toBe(66_150);
    expect(secondsToFrames(0.1 + 0.2, 10)).toBe(3);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s frames", (value) => {
    expect(() => assertFrames("start", value)).toThrow(RangeError);
  });
});

describe("a clip", () => {
  it("measures a clip by the range of its source it plays", () => {
    expect(clipLength(clip({ start: 10, end: 60 }))).toBe(50);
  });

  it("accepts a well-formed clip", () => {
    expect(() =>
      assertClip(
        clip({ fadeIn: { frames: 40, curve: "linear" }, fadeOut: { frames: 60, curve: "linear" } }),
        100,
      ),
    ).not.toThrow();
  });

  it.each([
    ["an empty clip", clip({ start: 50, end: 50 }), "clip-too-short"],
    ["a reversed clip", clip({ start: 60, end: 50 }), "clip-too-short"],
    ["a clip past its source", clip({ end: 101 }), "clip-outside-source"],
    ["fractional frames", clip({ end: 50.5 }), "invalid-frames"],
    ["a negative start", clip({ start: -1 }), "invalid-frames"],
    ["an infinite gain", clip({ gainDb: Number.POSITIVE_INFINITY }), "gain-out-of-range"],
    ["a gain above the maximum", clip({ gainDb: 120.5 }), "gain-out-of-range"],
    [
      "fades longer than the clip",
      clip({ fadeIn: { frames: 60, curve: "linear" }, fadeOut: { frames: 41, curve: "linear" } }),
      "fades-too-long",
    ],
  ] as const)("rejects %s, naming the problem", (_, bad, problem) => {
    expect(clipProblem(bad, 100)).toBe(problem);
    expect(() => assertClip(bad, 100)).toThrow(RangeError);
  });
});

describe("gainAt", () => {
  it("applies the clip's gain in decibels", () => {
    expect(gainAt(clip(), 50)).toBe(1);
    expect(gainAt(clip({ gainDb: -6 }), 50)).toBeCloseTo(0.501, 3);
    expect(dbToGain(20)).toBeCloseTo(10, 10);
  });

  it("fades in from silence on the first frame, and out to silence on the last", () => {
    const faded = clip({
      fadeIn: { frames: 10, curve: "linear" },
      fadeOut: { frames: 10, curve: "linear" },
    });
    expect(gainAt(faded, 0)).toBe(0);
    expect(gainAt(faded, 5)).toBe(0.5);
    expect(gainAt(faded, 10)).toBe(1);
    expect(gainAt(faded, 89)).toBe(1);
    expect(gainAt(faded, 94)).toBe(0.5);
    expect(gainAt(faded, 99)).toBe(0);
  });

  it("shapes equal-power fades with a quarter sine", () => {
    const faded = clip({ fadeIn: { frames: 10, curve: "equalPower" } });
    expect(gainAt(faded, 0)).toBe(0);
    expect(gainAt(faded, 5)).toBeCloseTo(Math.SQRT1_2, 10);
    expect(gainAt(faded, 10)).toBe(1);
  });

  it("multiplies overlapping fades and the gain", () => {
    const short = clip({
      end: 10,
      gainDb: -6,
      fadeIn: { frames: 5, curve: "linear" },
      fadeOut: { frames: 5, curve: "linear" },
    });
    // Frame 4 is 4/5 into the fade in, and 5/5 before the end.
    expect(gainAt(short, 4)).toBeCloseTo(dbToGain(-6) * 0.8, 10);
    expect(gainAt(short, 5)).toBeCloseTo(dbToGain(-6) * 0.8, 10);
  });
});
