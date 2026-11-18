import { describe, expect, it } from "vitest";
import { trackOf } from "../../../test/helpers/plans.js";
import type { AudioClip, AudioPlan } from "../../core/model/plan.js";
import { EMPTY_METADATA } from "../../core/model/plan.js";
import { canPlace, findClip, nudgeFrames, trimLimits } from "./clips.js";

const clip = (key: string, at: number, start: number, end: number): AudioClip => ({
  key,
  source: "s",
  start,
  end,
  at,
  gainDb: 0,
  fadeIn: { frames: 0, curve: "linear" },
  fadeOut: { frames: 0, curve: "linear" },
});

/** Two tracks: `a` with clips at 0–100 and 200–300, `b` with one at 150–250. */
const plan: AudioPlan = {
  sampleRate: 8_000,
  channels: 1,
  gainDb: 0,
  tracks: [
    trackOf("a", [clip("a1", 0, 50, 150), clip("a2", 200, 0, 100)]),
    trackOf("b", [clip("b1", 150, 30, 130)]),
  ],
  metadata: EMPTY_METADATA,
};

const sourceFrames = () => 1_000;

describe("canPlace", () => {
  it("allows moves into free space, up to touching a neighbour", () => {
    expect(canPlace(plan, ["a1"], 100)).toBe(true);
    expect(canPlace(plan, ["a2"], -100)).toBe(true);
    expect(canPlace(plan, ["a2"], 1_000)).toBe(true);
  });

  it("refuses a move that overlaps a clip that stays, or starts before the timeline", () => {
    expect(canPlace(plan, ["a1"], 101)).toBe(false);
    expect(canPlace(plan, ["a2"], -101)).toBe(false);
    expect(canPlace(plan, ["a1"], -1)).toBe(false);
  });

  it("checks the track a clip moves to, not the one it leaves", () => {
    expect(canPlace(plan, ["a1"], 0, "b")).toBe(true);
    expect(canPlace(plan, ["a2"], 0, "b")).toBe(false);
    expect(canPlace(plan, ["b1"], 0, "a")).toBe(false);
    expect(canPlace(plan, ["b1"], 150, "a")).toBe(true);
  });

  it("checks the moving clips against each other, and refuses unknown keys and tracks", () => {
    expect(canPlace(plan, ["a1", "a2"], 50)).toBe(true);
    expect(canPlace(plan, ["a1", "b1"], 0, "a")).toBe(false);
    expect(canPlace(plan, ["nope"], 0)).toBe(false);
    expect(canPlace(plan, ["a1"], 0, "nope")).toBe(false);
  });
});

describe("trimLimits", () => {
  it("lets a start grow to the source's start or the clip before, and shrink to one frame", () => {
    // a1 starts 50 frames into its source, at the timeline's start.
    expect(trimLimits(plan, sourceFrames, "a1", "start")).toEqual({ min: -99, max: 0 });
    // a2 has 100 frames of room before it, but its source starts where it does.
    expect(trimLimits(plan, sourceFrames, "a2", "start")).toEqual({ min: -99, max: 0 });
    // b1 has 150 frames of room, and 30 of source before it.
    expect(trimLimits(plan, sourceFrames, "b1", "start")).toEqual({ min: -99, max: 30 });
  });

  it("lets an end grow to the next clip or the source's end", () => {
    expect(trimLimits(plan, sourceFrames, "a1", "end")).toEqual({ min: -99, max: 100 });
    expect(trimLimits(plan, sourceFrames, "a2", "end")).toEqual({ min: -99, max: 900 });
    expect(trimLimits(plan, () => 120, "a2", "end")).toEqual({ min: -99, max: 20 });
  });

  it("allows nothing for a clip the plan doesn't have", () => {
    expect(trimLimits(plan, sourceFrames, "nope", "end")).toEqual({ min: 0, max: 0 });
  });
});

describe("findClip and nudgeFrames", () => {
  it("finds a clip with its track, and nudges by 10 ms", () => {
    expect(findClip(plan, "b1")?.track.key).toBe("b");
    expect(findClip(plan, "nope")).toBeUndefined();
    expect(nudgeFrames(plan)).toBe(80);
    expect(nudgeFrames({ ...plan, sampleRate: 50 })).toBe(1);
  });
});
