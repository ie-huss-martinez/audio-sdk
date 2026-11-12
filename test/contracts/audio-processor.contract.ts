import { describe, expect, it } from "vitest";
import {
  type AudioClip,
  type AudioMetadata,
  type AudioPlan,
  type AudioProcessor,
  type AudioSampleFormat,
  type DecodedAudio,
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

function clip(overrides: Partial<AudioClip>): AudioClip {
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

function plan(clips: AudioClip[], channels = 1, metadata = EMPTY_METADATA): AudioPlan {
  return { sampleRate: RATE, channels, clips, metadata };
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
 * ADR 0008). Adapters run it with their own harness.
 */
export function describeAudioProcessorContract(name: string, harness: AudioProcessorHarness): void {
  describe(`${name}: the AudioProcessor contract`, () => {
    const sources = () => new Map([["a", harness.decoded(RATE, [RAMP])]]);
    const float32 = { container: "wav", sampleFormat: "float32" } as const;

    it("renders one whole clip unchanged, at the plan's rate", async () => {
      const processor = harness.createProcessor();
      const output = await processor.render({
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
      const output = await processor.render({
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
      const output = await processor.render({
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
      const output = await processor.render({
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
      const output = await processor.render({
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

    it("writes the plan's metadata into the file", async () => {
      const processor = harness.createProcessor();
      const metadata = { ...EMPTY_METADATA, title: "Interview", artist: "Ana Núñez", year: "2026" };
      const output = await processor.render({
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
