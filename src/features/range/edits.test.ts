import { describe, expect, it } from "vitest";
import { trackOf } from "../../../test/helpers/plans.js";
import { type AudioClip, type AudioPlan, EMPTY_METADATA, NO_FADE } from "../../core/model/plan.js";
import { clipsInRange, splitAtRange } from "./edits.js";

const clip = (
  key: string,
  at: number,
  length: number,
  extra: Partial<AudioClip> = {},
): AudioClip => ({
  key,
  source: "s",
  start: 0,
  end: length,
  at,
  gainDb: 0,
  fadeIn: NO_FADE,
  fadeOut: NO_FADE,
  ...extra,
});

/** Track `a`: a clip at 0–100 and one at 150–250. Track `b`: one at 0–300. */
const plan: AudioPlan = {
  sampleRate: 8_000,
  channels: 1,
  gainDb: 0,
  tracks: [
    trackOf("a", [
      clip("a1", 0, 100, { fadeIn: { frames: 10, curve: "equalPower" } }),
      clip("a2", 150, 100, { fadeOut: { frames: 20, curve: "linear" } }),
    ]),
    trackOf("b", [clip("b1", 0, 300)]),
  ],
  metadata: EMPTY_METADATA,
};

function keys() {
  let next = 0;
  return () => `k${++next}`;
}

describe("splitAtRange", () => {
  it("splits a clip the range lies inside at both edges, keeping the piece between", () => {
    const { commands, pieces } = splitAtRange(plan, { start: 20, end: 60, tracks: ["a"] }, keys());
    expect(commands).toEqual([
      { type: "audio.splitClip", key: "a1", at: 20, newKey: "k1" },
      { type: "audio.splitClip", key: "k1", at: 60, newKey: "k2" },
    ]);
    // The piece between has neither of the clip's fades: those stay at its ends.
    expect(pieces).toEqual([
      { key: "k1", track: "a", at: 20, end: 60, fadeIn: NO_FADE, fadeOut: NO_FADE, gainDb: 0 },
    ]);
  });

  it("splits only where a clip crosses an edge, and keeps a clip that lies inside whole", () => {
    const { commands, pieces } = splitAtRange(plan, { start: 50, end: 300, tracks: ["a"] }, keys());
    expect(commands).toEqual([{ type: "audio.splitClip", key: "a1", at: 50, newKey: "k1" }]);
    expect(pieces.map((piece) => [piece.key, piece.at, piece.end])).toEqual([
      ["k1", 50, 100],
      ["a2", 150, 250],
    ]);
    // a2 lies inside whole, so it keeps its fade out.
    expect(pieces[1]?.fadeOut).toEqual({ frames: 20, curve: "linear" });
  });

  it("leaves the tracks outside the range, and the clips outside it, alone", () => {
    const { commands, pieces } = splitAtRange(
      plan,
      { start: 100, end: 150, tracks: ["a", "b"] },
      keys(),
    );
    // On a, the range is the gap between the clips; on b, it's inside b1.
    expect(pieces.map((piece) => piece.track)).toEqual(["b"]);
    expect(commands).toHaveLength(2);
  });

  it("lists the clips a range covers, before any split", () => {
    expect(
      clipsInRange(plan, { start: 90, end: 160, tracks: ["a"] }).map((each) => each.key),
    ).toEqual(["a1", "a2"]);
    expect(clipsInRange(plan, { start: 100, end: 150, tracks: ["a"] })).toEqual([]);
  });
});
