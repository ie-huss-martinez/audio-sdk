import { describe, expect, it } from "vitest";
import { sameClips } from "../../src/adapters/web-audio/play-graph.js";
import { createPlanReducer } from "../../src/core/operations/commands.js";
import { type AudioClipBody, type AudioPlan, NO_FADE } from "../../src/index.js";
import { singleTrack, trackOf } from "../helpers/plans.js";

const clip = (key: string, end: number): AudioClipBody => ({
  key,
  source: "s",
  start: 0,
  end,
  gainDb: 0,
  fadeIn: NO_FADE,
  fadeOut: NO_FADE,
});

describe("sameClips", () => {
  const reduce = createPlanReducer(() => 1_000);
  const base: AudioPlan = {
    ...singleTrack([clip("a", 100), clip("b", 50)]),
    tracks: [
      ...singleTrack([clip("a", 100), clip("b", 50)]).tracks,
      trackOf("music", [{ ...clip("m", 300), at: 0 }]),
    ],
  };
  const after = (command: Parameters<typeof reduce>[1]) => reduce(base, command).state;

  it("holds for changes of level, which the reducer makes without touching clips", () => {
    for (const next of [
      after({ type: "audio.setTrack", key: "music", muted: true }),
      after({ type: "audio.setTrack", key: "t", soloed: true, gainDb: -6, name: "Voice" }),
      after({ type: "audio.setMasterGain", gainDb: -3 }),
      after({ type: "audio.setMetadata", field: "title", value: "Take 2" }),
    ]) {
      expect(sameClips(base, next)).toBe(true);
      expect(sameClips(next, base)).toBe(true);
    }
  });

  it("holds for what isn't heard: the tracks' order, and tracks with no clips", () => {
    expect(sameClips(base, after({ type: "audio.moveTrack", key: "music", to: 0 }))).toBe(true);
    const wider = after({ type: "audio.addTrack", key: "fx", index: 1 });
    expect(sameClips(base, wider)).toBe(true);
    expect(sameClips(wider, base)).toBe(true);
  });

  it("fails for anything that changes what's scheduled", () => {
    for (const next of [
      after({ type: "audio.setGain", keys: ["a"], gainDb: -3 }),
      after({ type: "audio.moveClips", keys: ["m"], by: 10 }),
      after({ type: "audio.removeClips", keys: ["b"] }),
      after({ type: "audio.removeTracks", keys: ["music"] }),
      after({ type: "audio.moveClips", keys: ["b"], by: 500, track: "music" }),
      after({ type: "audio.setChannels", channels: 2 }),
      { ...base, sampleRate: 16_000 },
    ]) {
      expect(sameClips(base, next)).toBe(false);
    }
  });

  it("compares clips by identity, so an equal copy is scheduled again", () => {
    const copy = {
      ...base,
      tracks: base.tracks.map((track) => ({ ...track, clips: [...track.clips] })),
    };
    expect(sameClips(base, copy)).toBe(false);
  });
});
