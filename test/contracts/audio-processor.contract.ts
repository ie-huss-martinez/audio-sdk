import { describe, expect, it } from "vitest";
import {
  type AudioClip,
  type AudioClipBody,
  type AudioMetadata,
  type AudioPlan,
  type AudioProcessor,
  type AudioSampleFormat,
  type AudioTrack,
  type DecodedAudio,
  dbToGain,
  EMPTY_METADATA,
  gainAt,
  isAudioError,
  NO_FADE,
} from "../../src/index.js";

/** What an export produced, read back by the harness. */
export interface InspectedAudio {
  readonly sampleRate: number;
  readonly sampleFormat: AudioSampleFormat;
  readonly metadata: AudioMetadata;
  /** Each channel's samples, read back as floats. */
  readonly channels: readonly Float32Array[];
}

/**
 * What a processor's contract test needs: a way to create the processor,
 * decoded sources, and a way to read its output. The SDK's adapter reads
 * real WAV files; the fakes read fake ones.
 */
export interface AudioProcessorHarness {
  createProcessor(): AudioProcessor;
  /** Decoded audio holding exactly these samples, one array per channel. */
  decoded(sampleRate: number, channels: readonly (readonly number[])[]): DecodedAudio;
  inspect(output: Blob): Promise<InspectedAudio>;
}

const RATE = 8_000;
const RAMP = Array.from({ length: 100 }, (_, i) => (i - 50) / 100);
const PCM16_STEP = 1 / 32_767;

function clip(overrides: Partial<AudioClipBody>): AudioClipBody {
  return {
    key: "c",
    source: "a",
    start: 0,
    end: RAMP.length,
    gainDb: 0,
    fadeIn: NO_FADE,
    fadeOut: NO_FADE,
    ...overrides,
  };
}

function track(key: string, clips: AudioClip[], extra: Partial<AudioTrack> = {}): AudioTrack {
  return { key, name: "", gainDb: 0, muted: false, soloed: false, clips, ...extra };
}

function tracks(list: AudioTrack[], channels = 1, gainDb = 0): AudioPlan {
  return { sampleRate: RATE, channels, gainDb, tracks: list, metadata: EMPTY_METADATA };
}

/** One track, with the clips back to back from the start. */
function plan(clips: AudioClipBody[], channels = 1, metadata = EMPTY_METADATA): AudioPlan {
  let at = 0;
  const placed = clips.map((body) => {
    const positioned = { ...body, at };
    at += body.end - body.start;
    return positioned;
  });
  return { ...tracks([track("t", placed)], channels), metadata };
}

function expectSamples(actual: Float32Array | undefined, expected: number[], tolerance: number) {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    expect(
      Math.abs((actual?.[i] ?? Number.NaN) - (expected[i] ?? 0)),
      `frame ${i}`,
    ).toBeLessThanOrEqual(tolerance);
  }
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to reject");
}

/**
 * The behaviour every {@link AudioProcessor} must have (ADR 0001, ADR 0003,
 * ADR 0008, docs/adr/0006). Adapters run it with their own harness.
 */
export function describeAudioProcessorContract(name: string, harness: AudioProcessorHarness): void {
  describe(`${name}: the AudioProcessor contract`, () => {
    const sources = () => new Map([["a", harness.decoded(RATE, [RAMP])]]);
    const float32 = { container: "wav", sampleFormat: "float32" } as const;

    it("renders one whole clip unchanged, at the plan's rate", async () => {
      const processor = harness.createProcessor();
      const { blob: output } = await processor.render({
        plan: plan([clip({})]),
        sources: sources(),
        format: float32,
      });
      const inspected = await harness.inspect(output);
      expect(inspected).toMatchObject({ sampleRate: RATE, sampleFormat: "float32" });
      expectSamples(inspected.channels[0], RAMP.map(Math.fround), 0);
      await processor.destroy();
    });

    it("plays clips back to back, each from its source range", async () => {
      const processor = harness.createProcessor();
      const { blob: output } = await processor.render({
        plan: plan([
          clip({ key: "x", start: 60, end: 70 }),
          clip({ key: "y", start: 10, end: 15 }),
        ]),
        sources: sources(),
        format: float32,
      });
      const expected = [...RAMP.slice(60, 70), ...RAMP.slice(10, 15)].map(Math.fround);
      expectSamples((await harness.inspect(output)).channels[0], expected, 0);
      await processor.destroy();
    });

    it("applies each clip's gain and fades exactly as gainAt defines them", async () => {
      const processor = harness.createProcessor();
      const shaped = clip({
        key: "shaped",
        gainDb: -6,
        fadeIn: { frames: 20, curve: "linear" },
        fadeOut: { frames: 30, curve: "equalPower" },
      });
      // Fades without a gain change, so neither can stand in for the other.
      const fadedOnly = clip({
        key: "faded",
        fadeIn: { frames: 10, curve: "equalPower" },
        fadeOut: { frames: 40, curve: "linear" },
      });
      const { blob: output } = await processor.render({
        plan: plan([shaped, fadedOnly]),
        sources: sources(),
        format: float32,
      });
      const expected = [shaped, fadedOnly].flatMap((each) =>
        RAMP.map((sample, i) => Math.fround(sample * gainAt(each, i))),
      );
      expectSamples((await harness.inspect(output)).channels[0], expected, 1e-7);
      await processor.destroy();
    });

    it("clamps to full scale instead of wrapping around, in 16-bit PCM by default", async () => {
      const processor = harness.createProcessor();
      const { blob: output } = await processor.render({
        plan: plan([clip({ gainDb: 12 })]),
        sources: sources(),
        format: { container: "wav" },
      });
      const inspected = await harness.inspect(output);
      expect(inspected.sampleFormat).toBe("pcm16");
      const expected = RAMP.map((sample) =>
        Math.max(-1, Math.min(1, sample * gainAt(clip({ gainDb: 12 }), 0))),
      );
      expectSamples(inspected.channels[0], expected, PCM16_STEP);
      await processor.destroy();
    });

    it("plays a mono source on every channel of a stereo plan", async () => {
      const processor = harness.createProcessor();
      const { blob: output } = await processor.render({
        plan: plan([clip({ start: 0, end: 10 })], 2),
        sources: sources(),
        format: float32,
      });
      const { channels } = await harness.inspect(output);
      expect(channels).toHaveLength(2);
      const expected = RAMP.slice(0, 10).map(Math.fround);
      expectSamples(channels[0], expected, 0);
      expectSamples(channels[1], expected, 0);
      await processor.destroy();
    });

    it("leaves silence before a clip and between clips, where the timeline has none", async () => {
      const processor = harness.createProcessor();
      const { blob } = await processor.render({
        plan: tracks([
          track("t", [
            { ...clip({ key: "x", start: 0, end: 3 }), at: 2 },
            { ...clip({ key: "y", start: 10, end: 12 }), at: 7 },
          ]),
        ]),
        sources: sources(),
        format: float32,
      });
      const expected = [0, 0, ...RAMP.slice(0, 3), 0, 0, ...RAMP.slice(10, 12)].map(Math.fround);
      expectSamples((await harness.inspect(blob)).channels[0], expected, 0);
      await processor.destroy();
    });

    it("mixes tracks at unity, each at its gain, under the master gain", async () => {
      const processor = harness.createProcessor();
      const voice = { ...clip({ key: "v", start: 0, end: 20, gainDb: -3 }), at: 0 };
      const music = { ...clip({ key: "m", start: 40, end: 50 }), at: 5 };
      const { blob, clippedFrames } = await processor.render({
        plan: tracks([track("voice", [voice]), track("music", [music], { gainDb: -6 })], 1, -1.5),
        sources: sources(),
        format: float32,
      });
      const expected = Array.from({ length: 20 }, (_, frame) => {
        const first = (RAMP[frame] ?? 0) * gainAt(voice, frame);
        const within = frame - 5;
        const second = within >= 0 && within < 10 ? (RAMP[40 + within] ?? 0) * dbToGain(-6) : 0;
        return (first + second) * dbToGain(-1.5);
      });
      expectSamples((await harness.inspect(blob)).channels[0], expected, 1e-6);
      expect(clippedFrames).toBe(0);
      await processor.destroy();
    });

    it("leaves out muted tracks, plays only soloed ones, and ends where the last audible clip does", async () => {
      const processor = harness.createProcessor();
      const short = { ...clip({ key: "s", start: 0, end: 10 }), at: 0 };
      const long = { ...clip({ key: "l", start: 0, end: 80 }), at: 0 };
      const other = { ...clip({ key: "o", start: 50, end: 60 }), at: 0 };
      const render = async (list: AudioTrack[]) => {
        const { blob } = await processor.render({
          plan: tracks(list),
          sources: sources(),
          format: float32,
        });
        return (await harness.inspect(blob)).channels[0];
      };
      const only = RAMP.slice(0, 10).map(Math.fround);
      // The muted track is longer, and doesn't pad the file.
      expectSamples(
        await render([track("a", [short]), track("b", [long], { muted: true })]),
        only,
        0,
      );
      expectSamples(
        await render([
          track("a", [short], { soloed: true }),
          track("b", [long]),
          track("c", [other]),
        ]),
        only,
        0,
      );
      // Mute wins over solo.
      expectSamples(
        await render([
          track("a", [short], { soloed: true }),
          track("b", [long], { soloed: true, muted: true }),
        ]),
        only,
        0,
      );
      await processor.destroy();
    });

    it("reports the mix's peak, and how many frames it clamped", async () => {
      const processor = harness.createProcessor();
      // Two tracks of the same audio: twice the ramp, which peaks at -0.5.
      const twice = tracks([
        track("a", [{ ...clip({ key: "x" }), at: 0 }]),
        track("b", [{ ...clip({ key: "y" }), at: 0 }]),
      ]);
      const quiet = await processor.render({ plan: twice, sources: sources(), format: float32 });
      expect(quiet.peakDb).toBeCloseTo(0, 6);
      expect(quiet.clippedFrames).toBe(0);
      // 6 dB more: about twice again, so every frame over half scale clips.
      const loud = await processor.render({
        plan: { ...twice, gainDb: 6 },
        sources: sources(),
        format: float32,
      });
      expect(loud.peakDb).toBeCloseTo(6, 6);
      const over = RAMP.filter((sample) => Math.abs(sample * 2 * dbToGain(6)) > 1).length;
      expect(over).toBeGreaterThan(0);
      expect(loud.clippedFrames).toBe(over);
      const { channels } = await harness.inspect(loud.blob);
      expect(Math.min(...(channels[0] ?? []))).toBe(-1);
      // Silence has no peak.
      const silent = await processor.render({
        plan: tracks([
          track("a", [{ ...clip({ key: "x", gainDb: -120, start: 50, end: 51 }), at: 0 }]),
        ]),
        sources: sources(),
        format: float32,
      });
      expect(silent.peakDb).toBe(Number.NEGATIVE_INFINITY);
      await processor.destroy();
    });

    it("writes the plan's metadata into the file", async () => {
      const processor = harness.createProcessor();
      const metadata = { ...EMPTY_METADATA, title: "Interview", artist: "Ana Núñez", year: "2026" };
      const { blob: output } = await processor.render({
        plan: plan([clip({})], 1, metadata),
        sources: sources(),
        format: float32,
      });
      expect((await harness.inspect(output)).metadata).toEqual(metadata);
      await processor.destroy();
    });

    it("reports progress that only moves forward and ends at 1, and leaves sources alone", async () => {
      const processor = harness.createProcessor();
      const input = sources();
      const before = Float32Array.from(input.get("a")?.getChannelData(0) ?? []);
      const progress: number[] = [];
      await processor.render(
        {
          plan: plan([clip({ key: "x", end: 50 }), clip({ key: "y", start: 50, gainDb: -20 })]),
          sources: input,
          format: float32,
        },
        { onProgress: (fraction) => progress.push(fraction) },
      );
      expect(progress.at(-1)).toBe(1);
      expect(progress).toEqual([...progress].sort((a, b) => a - b));
      expect(input.get("a")?.getChannelData(0)).toEqual(before);
      await processor.destroy();
    });

    it("rejects a clip whose source is missing, and one outside its source", async () => {
      const processor = harness.createProcessor();
      await expect(
        processor.render({
          plan: plan([clip({ source: "b" })]),
          sources: sources(),
          format: float32,
        }),
      ).rejects.toThrow(TypeError);
      await expect(
        processor.render({ plan: plan([clip({ end: 101 })]), sources: sources(), format: float32 }),
      ).rejects.toThrow(RangeError);
      await processor.destroy();
    });

    it("rejects an aborted render with ABORTED", async () => {
      const processor = harness.createProcessor();
      const controller = new AbortController();
      controller.abort();
      const error = await rejection(
        processor.render(
          { plan: plan([clip({})]), sources: sources(), format: float32 },
          { signal: controller.signal },
        ),
      );
      expect(isAudioError(error, "ABORTED")).toBe(true);
      await processor.destroy();
    });

    it("rejects renders after destroy", async () => {
      const processor = harness.createProcessor();
      await processor.destroy();
      await expect(
        processor.render({ plan: plan([clip({})]), sources: sources(), format: float32 }),
      ).rejects.toThrow();
    });
  });
}
