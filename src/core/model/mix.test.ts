import { describe, expect, it } from "vitest";
import { fakeDecoded } from "../../../test/fakes/fake-audio.js";
import { trackOf } from "../../../test/helpers/plans.js";
import { dbToGain, gainAt } from "./envelope.js";
import { channelMix, gatherSegments, mixBlock, mixLength } from "./mix.js";
import {
  type AudioClip,
  type AudioPlan,
  type AudioTrack,
  EMPTY_METADATA,
  NO_FADE,
} from "./plan.js";

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

describe("the mix", () => {
  const RAMP = Array.from({ length: 40 }, (_, i) => (i - 20) / 40);
  const audio = (...channels: number[][]) => fakeDecoded(8_000, channels);
  const sources = new Map([
    ["mono", audio(RAMP)],
    [
      "stereo",
      audio(
        RAMP.map((sample) => sample / 2),
        RAMP.map((sample) => -sample),
      ),
    ],
  ]);
  const clip = (
    key: string,
    at: number,
    start: number,
    end: number,
    extra: Partial<AudioClip> = {},
  ): AudioClip => ({
    key,
    at,
    source: "mono",
    start,
    end,
    gainDb: 0,
    fadeIn: NO_FADE,
    fadeOut: NO_FADE,
    ...extra,
  });
  const plan = (tracks: AudioTrack[], channels = 1, gainDb = 0): AudioPlan => ({
    sampleRate: 8_000,
    channels,
    gainDb,
    tracks,
    metadata: EMPTY_METADATA,
  });
  /** The mix of frames `[start, start + frames)`. */
  const mix = (state: AudioPlan, start = 0, frames = mixLength(state) - start) =>
    mixBlock({
      channels: state.channels,
      frames,
      gain: dbToGain(state.gainDb),
      segments: gatherSegments(state, sources, start, frames),
    });
  const close = (actual: Float32Array | undefined, expected: number[]) => {
    expect(actual).toHaveLength(expected.length);
    for (const [i, value] of expected.entries()) expect(actual?.[i]).toBeCloseTo(value, 6);
  };

  it("is as long as the last audible clip", () => {
    const long = trackOf("long", [clip("l", 10, 0, 30)]);
    const short = trackOf("short", [clip("s", 0, 0, 5)]);
    expect(mixLength(plan([long, short]))).toBe(40);
    expect(mixLength(plan([{ ...long, muted: true }, short]))).toBe(5);
    expect(mixLength(plan([long, { ...short, soloed: true }]))).toBe(5);
    expect(mixLength(plan([trackOf("empty", [])]))).toBe(0);
  });

  it("places each clip where it is, with silence around it", () => {
    const { channels, peak, clipped } = mix(
      plan([trackOf("t", [clip("a", 2, 20, 23), clip("b", 7, 30, 32)])]),
    );
    close(channels[0], [0, 0, 0, 1 / 40, 2 / 40, 0, 0, 10 / 40, 11 / 40]);
    expect(peak).toBeCloseTo(11 / 40, 6);
    expect(clipped).toBe(0);
  });

  it("sums tracks at unity, each at its gain, then applies the master gain", () => {
    const voice = clip("v", 0, 30, 34, { gainDb: -3 });
    const music = clip("m", 2, 36, 40);
    const { channels } = mix(
      plan([trackOf("voice", [voice]), trackOf("music", [music], { gainDb: -6 })], 1, 2),
    );
    const master = dbToGain(2);
    const v = (i: number) => (RAMP[30 + i] as number) * dbToGain(-3);
    const m = (i: number) => (RAMP[36 + i] as number) * dbToGain(-6);
    close(channels[0], [
      v(0) * master,
      v(1) * master,
      (v(2) + m(0)) * master,
      (v(3) + m(1)) * master,
      m(2) * master,
      m(3) * master,
    ]);
  });

  it("applies a clip's fades from its own start, wherever the block begins", () => {
    const faded = clip("f", 4, 0, 20, {
      fadeIn: { frames: 8, curve: "linear" },
      fadeOut: { frames: 6, curve: "equalPower" },
    });
    const state = plan([trackOf("t", [faded])]);
    const whole = mix(state).channels[0] as Float32Array;
    for (let i = 0; i < 20; i += 1) {
      expect(whole[4 + i]).toBeCloseTo((RAMP[i] as number) * gainAt(faded, i), 6);
    }
    // The same frames, whatever blocks they're cut into.
    for (const size of [1, 3, 7, 24]) {
      const parts: number[] = [];
      for (let start = 0; start < whole.length; start += size) {
        const frames = Math.min(size, whole.length - start);
        parts.push(...(mix(state, start, frames).channels[0] as Float32Array));
      }
      expect(parts).toEqual([...whole]);
    }
  });

  it("mixes sources to the plan's channels by the speaker rules", () => {
    const stereo = clip("s", 0, 30, 32, { source: "stereo" });
    const down = mix(plan([trackOf("t", [stereo])], 1));
    // Stereo to mono is the average of the two channels.
    close(down.channels[0], [(10 / 80 - 10 / 40) / 2, (11 / 80 - 11 / 40) / 2]);
    const up = mix(plan([trackOf("t", [clip("m", 0, 30, 32)])], 2));
    close(up.channels[0], [10 / 40, 11 / 40]);
    close(up.channels[1], [10 / 40, 11 / 40]);
  });

  it("leaves out muted tracks, and all but the soloed ones", () => {
    const a = trackOf("a", [clip("a", 0, 30, 32)]);
    const b = trackOf("b", [clip("b", 0, 38, 40)]);
    close(mix(plan([a, { ...b, muted: true }])).channels[0], [10 / 40, 11 / 40]);
    close(mix(plan([a, { ...b, soloed: true }])).channels[0], [18 / 40, 19 / 40]);
    expect(gatherSegments(plan([{ ...a, muted: true }]), sources, 0, 2)).toEqual([]);
  });

  it("clamps what goes over full scale, and says how far and how often", () => {
    const loud = plan(
      [trackOf("a", [clip("a", 0, 0, 40)]), trackOf("b", [clip("b", 0, 0, 40)])],
      1,
      12,
    );
    const { channels, peak, clipped } = mix(loud);
    const values = RAMP.map((sample) => sample * 2 * dbToGain(12));
    expect(peak).toBeCloseTo(Math.max(...values.map(Math.abs)), 6);
    expect(clipped).toBe(values.filter((value) => Math.abs(value) > 1).length);
    expect(clipped).toBeGreaterThan(0);
    close(
      channels[0],
      values.map((value) => Math.max(-1, Math.min(1, value))),
    );
  });

  it("copies the samples it gathers, and names a missing source", () => {
    const state = plan([trackOf("t", [clip("a", 0, 0, 4)])]);
    const [segment] = gatherSegments(state, sources, 0, 4);
    (segment?.samples[0] as Float32Array)[0] = 99;
    expect(sources.get("mono")?.getChannelData(0)[0]).toBe(Math.fround(RAMP[0] as number));
    expect(() => gatherSegments(state, new Map(), 0, 4)).toThrow(TypeError);
  });
});
