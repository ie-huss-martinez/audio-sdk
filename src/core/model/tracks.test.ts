import { describe, expect, it } from "vitest";
import { EMPTY_METADATA, NO_FADE } from "./plan.js";
import {
  type AudioTrack,
  type AudioTrackClip,
  type AudioTrackPlan,
  audibleTracks,
  clipAt,
  clipEnd,
  clipIndexAt,
  orderProblem,
  trackLength,
  trackPlanLength,
} from "./tracks.js";

const clip = (key: string, at: number, length: number): AudioTrackClip => ({
  key,
  at,
  source: "s1",
  start: 0,
  end: length,
  gainDb: 0,
  fadeIn: NO_FADE,
  fadeOut: NO_FADE,
});

const track = (
  key: string,
  clips: AudioTrackClip[],
  extra: Partial<AudioTrack> = {},
): AudioTrack => ({
  key,
  name: "",
  gainDb: 0,
  muted: false,
  soloed: false,
  clips,
  ...extra,
});

const plan = (...tracks: AudioTrack[]): AudioTrackPlan => ({
  sampleRate: 48_000,
  channels: 2,
  gainDb: 0,
  tracks,
  metadata: EMPTY_METADATA,
});

describe("lengths", () => {
  it("measure a clip, a track and the plan, with the silence before clips", () => {
    const voice = track("voice", [clip("a", 10, 20), clip("b", 50, 5)]);
    expect(clipEnd(clip("a", 10, 20))).toBe(30);
    expect(trackLength(voice)).toBe(55);
    expect(trackLength(track("empty", []))).toBe(0);
    expect(trackPlanLength(plan(voice, track("music", [clip("m", 100, 1)])))).toBe(101);
    expect(trackPlanLength(plan(track("empty", [])))).toBe(0);
  });
});

describe("audibleTracks", () => {
  const keys = (...tracks: AudioTrack[]) => audibleTracks(plan(...tracks)).map((t) => t.key);

  it("leaves out muted tracks", () => {
    expect(keys(track("a", []), track("b", [], { muted: true }))).toEqual(["a"]);
  });

  it("keeps only soloed tracks once any is soloed", () => {
    expect(
      keys(track("a", []), track("b", [], { soloed: true }), track("c", [], { soloed: true })),
    ).toEqual(["b", "c"]);
  });

  it("lets mute win over solo", () => {
    expect(keys(track("a", []), track("b", [], { soloed: true, muted: true }))).toEqual([]);
  });
});

describe("orderProblem", () => {
  it("accepts clips in order, touching or apart", () => {
    expect(orderProblem([])).toBeUndefined();
    expect(orderProblem([clip("a", 0, 10), clip("b", 10, 10), clip("c", 25, 1)])).toBeUndefined();
  });

  it("names clips that overlap, and clips out of order", () => {
    expect(orderProblem([clip("a", 0, 10), clip("b", 9, 10)])).toBe("clips-overlap");
    expect(orderProblem([clip("a", 0, 10), clip("b", 0, 10)])).toBe("clips-overlap");
    expect(orderProblem([clip("a", 20, 10), clip("b", 0, 10)])).toBe("clips-out-of-order");
  });
});

describe("finding the clip at a frame", () => {
  const voice = track("voice", [clip("a", 10, 20), clip("b", 30, 5), clip("c", 50, 5)]);

  it("finds the clip that plays a frame, and nothing in silence", () => {
    expect(clipAt(voice, 9)).toBeUndefined();
    expect(clipAt(voice, 10)?.key).toBe("a");
    expect(clipAt(voice, 29)?.key).toBe("a");
    // A frame on a boundary belongs to the clip that starts there.
    expect(clipAt(voice, 30)?.key).toBe("b");
    expect(clipAt(voice, 35)).toBeUndefined();
    expect(clipAt(voice, 54)?.key).toBe("c");
    expect(clipAt(voice, 55)).toBeUndefined();
  });

  it("gives the index of the first clip that ends after a frame", () => {
    expect([0, 29, 30, 40, 54, 55].map((frame) => clipIndexAt(voice.clips, frame))).toEqual([
      0, 0, 1, 2, 2, 3,
    ]);
    expect(clipIndexAt([], 0)).toBe(0);
  });
});
