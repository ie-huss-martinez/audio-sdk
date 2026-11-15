import { audioOutput } from "@hussmartinez/sdk-config/testing/audio-output";
import { beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { schedulePlan } from "../../src/adapters/web-audio/play-graph.js";
import {
  type AudioClip,
  type AudioPlan,
  createAudioOutput,
  createAudioProcessor,
  type DecodedAudio,
  EMPTY_METADATA,
  NO_FADE,
  planLength,
} from "../../src/index.js";
import { describeAudioOutputContract } from "../contracts/audio-output.contract.js";
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
});

describe("the playback graph", () => {
  const clip = (
    key: string,
    source: string,
    start: number,
    end: number,
    extra: Partial<AudioClip> = {},
  ): AudioClip => ({
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
    const frames = planLength(plan) - from;
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
    const plan: AudioPlan = {
      sampleRate: RATE,
      channels,
      metadata: EMPTY_METADATA,
      clips: [
        clip("a", "mono", 100, 400, {
          gainDb: -3,
          fadeIn: { frames: 60, curve: "equalPower" },
          fadeOut: { frames: 90, curve: "linear" },
        }),
        clip("b", "stereo", 0, 250, { fadeIn: { frames: 120, curve: "linear" } }),
        clip("c", "mono", 500, 700, { gainDb: 6, fadeOut: { frames: 200, curve: "equalPower" } }),
      ],
    };
    const exported = await inspectWav(
      await createAudioProcessor().render({
        plan,
        sources,
        format: { container: "wav", sampleFormat: "float32" },
      }),
    );
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
  });

  it("renders from the middle of a fade as from the start", async () => {
    const sources = new Map<string, DecodedAudio>([["mono", audioBuffer(RATE, [tone(800, 0)])]]);
    const plan: AudioPlan = {
      sampleRate: RATE,
      channels: 1,
      metadata: EMPTY_METADATA,
      clips: [
        clip("a", "mono", 0, 400, {
          fadeIn: { frames: 200, curve: "equalPower" },
          fadeOut: { frames: 150, curve: "linear" },
        }),
      ],
    };
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
