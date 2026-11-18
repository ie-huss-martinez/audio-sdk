import { audioOutput } from "@hussmartinez/sdk-config/testing/audio-output";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { createOutput } from "../../src/adapters/audio-output.js";
import { GAIN_RAMP, schedulePlan } from "../../src/adapters/web-audio/play-graph.js";
import {
  type AudioClipBody,
  type AudioPlan,
  createAudioOutput,
  createAudioProcessor,
  type DecodedAudio,
  mixLength,
  NO_FADE,
  planLength,
} from "../../src/index.js";
import { describeAudioOutputContract } from "../contracts/audio-output.contract.js";
import { backToBack, singleTrack, trackOf } from "../helpers/plans.js";
import { inspectWav } from "./wav-reader.js";

/** A real AudioBuffer holding these samples. */
function audioBuffer(sampleRate: number, channels: readonly (readonly number[])[]): AudioBuffer {
  const buffer = new AudioBuffer({
    sampleRate,
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
  });
  for (const [channel, samples] of channels.entries()) {
    buffer.copyToChannel(Float32Array.from(samples), channel);
  }
  return buffer;
}

const RATE = 8_000;

describe("the Web Audio output, playing in real time", () => {
  // It needs real-time audio output, which Firefox in the browser test
  // image doesn't have (sdk-core ADR 0043). The probe runs inside the
  // hook, never when the file loads, and its click gives the page the user
  // activation that playback needs.
  let reason: string | undefined;
  beforeEach(async (context) => {
    if (reason === undefined) {
      const audio = await audioOutput({ activate: (button) => userEvent.click(button) });
      reason = audio.available ? "" : `no real-time audio output${audio.reason}`;
    }
    if (reason !== "") context.skip(reason);
  });

  describeAudioOutputContract("audio output", {
    create() {
      const output = createAudioOutput();
      return {
        output,
        elapse: (frames) => new Promise((resolve) => setTimeout(resolve, (frames / RATE) * 1_000)),
      };
    },
    decoded: audioBuffer,
    // A real clock, read by a busy browser: 100 ms either way, plus the
    // start lead.
    positionTolerance: RATE / 10,
  });

  it("changes a track's level while playing without scheduling its clips again", async () => {
    let scheduled = 0;
    const output = createOutput({
      createContext: () => {
        const context = new AudioContext();
        const create = context.createBufferSource.bind(context);
        context.createBufferSource = () => {
          scheduled += 1;
          return create();
        };
        return context;
      },
    });
    const body = { source: "a", gainDb: 0, fadeIn: NO_FADE, fadeOut: NO_FADE };
    const voice = [{ ...body, key: "v", start: 0, end: RATE, at: 0 }];
    const music = [{ ...body, key: "m", start: 0, end: RATE, at: 0 }];
    const plan: AudioPlan = {
      ...singleTrack([], { sampleRate: RATE }),
      tracks: [trackOf("voice", voice), trackOf("music", music)],
    };
    const sources = new Map([["a", audioBuffer(RATE, [new Array(RATE).fill(0.01)])]]);
    output.load(plan, sources);
    await output.play();
    expect(scheduled).toBe(2);
    // A mute, a solo, a gain and the master gain: the same nodes, at new levels.
    const [first, second] = plan.tracks as [AudioPlan["tracks"][0], AudioPlan["tracks"][0]];
    output.load({ ...plan, tracks: [first, { ...second, muted: true }] }, sources);
    output.load({ ...plan, tracks: [{ ...first, soloed: true, gainDb: -6 }, second] }, sources);
    output.load({ ...plan, gainDb: -3 }, sources);
    expect(scheduled).toBe(2);
    expect(output.getSnapshot().state).toBe("playing");
    // A clip that moves is scheduled again, from the playhead.
    output.load(
      {
        ...plan,
        tracks: [first, trackOf("music", [{ ...(music[0] as (typeof music)[0]), at: 10 }])],
      },
      sources,
    );
    expect(scheduled).toBe(4);
    await output.destroy();
  });
});

describe("the playback graph", () => {
  const clip = (
    key: string,
    source: string,
    start: number,
    end: number,
    extra: Partial<AudioClipBody> = {},
  ): AudioClipBody => ({
    key,
    source,
    start,
    end,
    gainDb: 0,
    fadeIn: NO_FADE,
    fadeOut: NO_FADE,
    ...extra,
  });
  const tone = (length: number, phase: number) =>
    Array.from({ length }, (_, i) => Math.sin((i + phase) / 5) * 0.6);

  /** Renders a plan from a frame through the playback graph, offline, at the plan's rate. */
  async function renderGraph(plan: AudioPlan, sources: Map<string, DecodedAudio>, from = 0) {
    const frames = mixLength(plan) - from;
    const context = new OfflineAudioContext(plan.channels, frames, plan.sampleRate);
    schedulePlan(
      context,
      context.destination,
      plan,
      (id) => sources.get(id) as AudioBuffer,
      from,
      0,
    );
    const rendered = await context.startRendering();
    return Array.from({ length: plan.channels }, (_, c) => rendered.getChannelData(c));
  }

  // ADR 0001's oracle: playback and export render the same plan alike.
  it.each([
    ["a mono plan from a stereo source", 1],
    ["a stereo plan from a mono and a stereo source", 2],
  ])("renders %s as export does, gains and fades included", async (_, channels) => {
    const sources = new Map<string, DecodedAudio>([
      ["mono", audioBuffer(RATE, [tone(800, 0)])],
      ["stereo", audioBuffer(RATE, [tone(800, 3), tone(800, 7)])],
    ]);
    const plan = singleTrack(
      [
        clip("a", "mono", 100, 400, {
          gainDb: -3,
          fadeIn: { frames: 60, curve: "equalPower" },
          fadeOut: { frames: 90, curve: "linear" },
        }),
        clip("b", "stereo", 0, 250, { fadeIn: { frames: 120, curve: "linear" } }),
        clip("c", "mono", 500, 700, { gainDb: 6, fadeOut: { frames: 200, curve: "equalPower" } }),
      ],
      { sampleRate: RATE, channels },
    );
    await expectPlayedAsExported(plan, sources);
  });

  it("mixes tracks as export does: positions, track gains, the master gain, mute and solo", async () => {
    const sources = new Map<string, DecodedAudio>([
      ["mono", audioBuffer(RATE, [tone(800, 0)])],
      ["stereo", audioBuffer(RATE, [tone(800, 3), tone(800, 7)])],
    ]);
    const voice = [
      { ...clip("a", "mono", 0, 200, { fadeIn: { frames: 50, curve: "linear" } }), at: 40 },
      { ...clip("b", "mono", 300, 500, { gainDb: -2 }), at: 400 },
    ];
    const music = [{ ...clip("m", "stereo", 0, 700, { gainDb: -4 }), at: 0 }];
    const base: AudioPlan = {
      ...singleTrack([], { sampleRate: RATE, channels: 2 }),
      gainDb: -3,
      tracks: [
        trackOf("voice", voice, { gainDb: 2 }),
        trackOf("music", music, { gainDb: -6 }),
        // Longer than the others, and silent: it neither sounds nor pads.
        trackOf("scratch", backToBack([clip("s", "mono", 0, 790)]), { muted: true }),
      ],
    };
    await expectPlayedAsExported(base, sources);
    const [first, second, third] = base.tracks;
    if (!first || !second || !third) throw new Error("unreachable");
    await expectPlayedAsExported(
      { ...base, tracks: [{ ...first, soloed: true }, second, third] },
      sources,
    );
  });

  /** Renders the playback graph offline and the export, and compares them sample for sample. */
  async function expectPlayedAsExported(
    plan: AudioPlan,
    sources: Map<string, DecodedAudio>,
  ): Promise<void> {
    const { channels } = plan;
    const { blob } = await createAudioProcessor().render({
      plan,
      sources,
      format: { container: "wav", sampleFormat: "float32" },
    });
    const exported = await inspectWav(blob);
    const played = await renderGraph(plan, sources);
    expect(played).toHaveLength(channels);
    for (const [c, samples] of played.entries()) {
      const expected = exported.channels[c] as Float32Array;
      expect(samples.length).toBe(expected.length);
      let worst = 0;
      let where = 0;
      for (let i = 0; i < samples.length; i += 1) {
        // The device clips playback at full scale, as export clamps it.
        const played = Math.max(-1, Math.min(1, samples[i] as number));
        const difference = Math.abs(played - (expected[i] as number));
        if (difference > worst) {
          worst = difference;
          where = i;
        }
      }
      expect(worst, `channel ${c}, worst at frame ${where}`).toBeLessThan(1e-3);
    }
  }

  describe("changing levels while it plays", () => {
    const sources = new Map<string, DecodedAudio>([
      ["mono", audioBuffer(RATE, [tone(800, 0)])],
      ["stereo", audioBuffer(RATE, [tone(800, 3), tone(800, 7)])],
    ]);
    const base: AudioPlan = {
      ...singleTrack([], { sampleRate: RATE, channels: 2 }),
      tracks: [
        trackOf("voice", [
          { ...clip("a", "mono", 0, 300, { gainDb: -2 }), at: 20 },
          { ...clip("b", "mono", 300, 600), at: 380 },
        ]),
        trackOf("music", [{ ...clip("m", "stereo", 0, 700, { gainDb: -4 }), at: 0 }], {
          gainDb: -3,
        }),
        trackOf("scratch", backToBack([clip("s", "mono", 0, 790)]), { muted: true }),
      ],
    };
    const [voice, music, scratch] = base.tracks as [
      AudioPlan["tracks"][0],
      AudioPlan["tracks"][0],
      AudioPlan["tracks"][0],
    ];
    const exported = async (plan: AudioPlan) => {
      const { blob } = await createAudioProcessor().render({
        plan,
        sources,
        format: { container: "wav", sampleFormat: "float32" },
      });
      return (await inspectWav(blob)).channels;
    };

    it.each<[string, AudioPlan]>([
      ["muting a track", { ...base, tracks: [voice, { ...music, muted: true }, scratch] }],
      ["soloing a track", { ...base, tracks: [{ ...voice, soloed: true }, music, scratch] }],
      ["unmuting a track", { ...base, tracks: [voice, music, { ...scratch, muted: false }] }],
      // Both down: the two ramps multiply, and a product of ramps that go
      // the same way stays between where it starts and where it ends.
      [
        "a track's gain and the master gain",
        { ...base, gainDb: -5, tracks: [{ ...voice, gainDb: -4 }, music, scratch] },
      ],
      ["reordering tracks", { ...base, tracks: [scratch, music, voice] }],
    ])(
      "plays the plan before %s, and the new one from 5 ms after, without scheduling a clip again",
      async (_, next) => {
        const frames = planLength(base);
        const change = 300;
        const context = new OfflineAudioContext(2, frames, RATE);
        const created = vi.spyOn(context, "createBufferSource");
        const scheduled = schedulePlan(
          context,
          context.destination,
          base,
          (id) => sources.get(id) as AudioBuffer,
          0,
          0,
        );
        // Every track with clips is scheduled, muted or not.
        expect(created).toHaveBeenCalledTimes(4);
        scheduled.setLevels(next, change / RATE);
        expect(created).toHaveBeenCalledTimes(4);
        const rendered = await context.startRendering();
        const [before, after] = [await exported(base), await exported(next)];
        const settled = change + Math.ceil(GAIN_RAMP * RATE);
        for (let c = 0; c < 2; c += 1) {
          const played = rendered.getChannelData(c);
          // Past an export's end, there's silence.
          const old = (frame: number) => before[c]?.[frame] ?? 0;
          const fresh = (frame: number) => after[c]?.[frame] ?? 0;
          let worst = 0;
          for (let frame = 0; frame < frames; frame += 1) {
            const sample = Math.max(-1, Math.min(1, played[frame] as number));
            if (frame < change) worst = Math.max(worst, Math.abs(sample - old(frame)));
            else if (frame >= settled) worst = Math.max(worst, Math.abs(sample - fresh(frame)));
            else {
              // Within the ramp, it's between the two.
              const low = Math.min(old(frame), fresh(frame)) - 1e-3;
              const high = Math.max(old(frame), fresh(frame)) + 1e-3;
              expect(sample, `frame ${frame} of the ramp`).toBeGreaterThanOrEqual(low);
              expect(sample, `frame ${frame} of the ramp`).toBeLessThanOrEqual(high);
            }
          }
          expect(worst, `channel ${c}`).toBeLessThan(1e-3);
        }
      },
    );
  });

  it("renders from the middle of a fade as from the start", async () => {
    const sources = new Map<string, DecodedAudio>([["mono", audioBuffer(RATE, [tone(800, 0)])]]);
    const plan = singleTrack(
      [
        clip("a", "mono", 0, 400, {
          fadeIn: { frames: 200, curve: "equalPower" },
          fadeOut: { frames: 150, curve: "linear" },
        }),
      ],
      { sampleRate: RATE },
    );
    const whole = (await renderGraph(plan, sources))[0] as Float32Array;
    for (const from of [120, 300]) {
      const part = (await renderGraph(plan, sources, from))[0] as Float32Array;
      let worst = 0;
      for (let i = 0; i < part.length; i += 1) {
        worst = Math.max(worst, Math.abs((part[i] as number) - (whole[from + i] as number)));
      }
      expect(worst, `from ${from}`).toBeLessThan(1e-3);
    }
  });
});
