import type { WorkerLike } from "@hussmartinez/sdk-core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createProcessor, EXPORT_BLOCK_FRAMES } from "../../src/adapters/audio-processor.js";
import { quantise } from "../../src/adapters/wav/wav-writer.js";
import { channelMix } from "../../src/core/model/mix.js";
import {
  type AudioClip,
  type AudioPlan,
  type AudioSampleFormat,
  clipLength,
  EMPTY_METADATA,
  gainAt,
  NO_FADE,
} from "../../src/index.js";
import { describeAudioProcessorContract } from "../contracts/audio-processor.contract.js";
import { startInProcessWorker } from "./in-process-worker.js";
import { inspectWav, memoryAudio } from "./wav-reader.js";

/** The processor with the real worker's code, run in this thread. */
function processor(start: () => WorkerLike = startInProcessWorker) {
  return createProcessor({
    loadWorker: async () => start,
    version: __AUDIO_SDK_VERSION__,
    idleTimeout: 0,
  });
}

describeAudioProcessorContract("audio processor", {
  createProcessor: () => processor(),
  decoded: memoryAudio,
  inspect: inspectWav,
});

const clip = (changes: Partial<AudioClip>): AudioClip => ({
  key: "c",
  source: "a",
  start: 0,
  end: 1,
  gainDb: 0,
  fadeIn: NO_FADE,
  fadeOut: NO_FADE,
  ...changes,
});

const plan = (clips: AudioClip[], channels = 1): AudioPlan => ({
  sampleRate: 8_000,
  channels,
  clips,
  metadata: EMPTY_METADATA,
});

/** What a sample reads back as, through a reader that divides by 2ⁿ⁻¹. */
function stored(sample: number, format: AudioSampleFormat): number {
  const value = quantise(sample, format);
  if (format === "float32") return value;
  return Math.fround(value / (format === "pcm16" ? 0x8000 : 0x800000));
}

describe("the audio processor", () => {
  it("renders across blocks, sending the worker at most 2¹⁶ frames per channel at a time", async () => {
    const sizes: number[] = [];
    // Watches what the page sends, as the worker receives it.
    const watched = (): WorkerLike => {
      const worker = startInProcessWorker();
      return {
        ...worker,
        postMessage(message, transfer) {
          const call = message as {
            method?: string;
            input?: { segments?: { frames: number; samples: Float32Array[] }[] };
          };
          if (call.method === "renderBlock") {
            for (const segment of call.input?.segments ?? []) {
              for (const samples of segment.samples) sizes.push(samples.length);
            }
          }
          worker.postMessage(message, transfer);
        },
      };
    };
    const length = EXPORT_BLOCK_FRAMES * 2 + 1_234;
    const ramp = Float32Array.from({ length }, (_, i) => ((i % 2_000) - 1_000) / 1_000);
    // + 0, so the mirror has no −0, which a mix that starts from 0 can't produce.
    const mirror = ramp.map((x) => -x + 0);
    const sources = new Map([["a", memoryAudio(8_000, [ramp, mirror])]]);
    const first = clip({ key: "x", end: 70_000 });
    const second = clip({ key: "y", start: 70_000, end: length });
    const output = await processor(watched).render({
      plan: plan([first, second], 2),
      sources,
      format: { container: "wav", sampleFormat: "float32" },
    });
    expect(Math.max(...sizes)).toBeLessThanOrEqual(EXPORT_BLOCK_FRAMES);
    // Three blocks, the second split between the two clips.
    expect(sizes).toHaveLength(8);
    const { channels } = await inspectWav(output);
    expect(channels[0]).toEqual(ramp);
    expect(channels[1]).toEqual(mirror);
  });

  it("pads an odd number of sample bytes, so the RIFF size matches the file", async () => {
    const output = await processor().render({
      plan: plan([clip({ end: 3 })]),
      sources: new Map([["a", memoryAudio(8_000, [[0.1, 0.2, 0.3]])]]),
      format: { container: "wav", sampleFormat: "pcm24" },
    });
    const bytes = new Uint8Array(await output.arrayBuffer());
    expect(bytes.length % 2).toBe(0);
    expect(new DataView(bytes.buffer).getUint32(4, true)).toBe(bytes.length - 8);
    expect((await inspectWav(output)).channels[0]).toHaveLength(3);
  });

  it("writes an empty plan as a valid file with no frames", async () => {
    const output = await processor().render({
      plan: plan([]),
      sources: new Map(),
      format: { container: "wav" },
    });
    const bytes = new Uint8Array(await output.arrayBuffer());
    expect(new DataView(bytes.buffer).getUint32(4, true)).toBe(bytes.length - 8);
  });

  it("refuses formats it can't write", async () => {
    const job = { plan: plan([]), sources: new Map() };
    await expect(
      processor().render({ ...job, format: { container: "mp3" as "wav" } }),
    ).rejects.toThrow(TypeError);
    await expect(
      processor().render({ ...job, format: { container: "wav", sampleFormat: "pcm8" as "pcm16" } }),
    ).rejects.toThrow(TypeError);
  });

  it("reads back exactly what the rules say, for any plan, layout and format", async () => {
    // Rendered as float32 per frame: the mix by the speaker rules, times
    // gainAt, then quantised. The reader gets back exactly that.
    const layouts = [1, 2, 3, 4, 6] as const;
    const sample = fc.double({ min: -1.5, max: 1.5, noNaN: true });
    const source = fc
      .record({ channels: fc.constantFrom(...layouts), length: fc.integer({ min: 1, max: 40 }) })
      .chain(({ channels, length }) =>
        fc.array(fc.array(sample, { minLength: length, maxLength: length }), {
          minLength: channels,
          maxLength: channels,
        }),
      );
    const curve = fc.constantFrom("linear" as const, "equalPower" as const);
    const job = fc
      .record({
        sources: fc.array(source, { minLength: 1, maxLength: 3 }),
        channels: fc.constantFrom(...layouts),
        sampleFormat: fc.constantFrom("pcm16" as const, "pcm24" as const, "float32" as const),
      })
      .chain(({ sources, channels, sampleFormat }) =>
        fc
          .array(
            fc
              .record({
                source: fc.nat(sources.length - 1),
                a: fc.nat(),
                b: fc.nat(),
                gainDb: fc.double({ min: -30, max: 12, noNaN: true }),
                fadeIn: fc.record({ share: fc.double({ min: 0, max: 0.5, noNaN: true }), curve }),
                fadeOut: fc.record({ share: fc.double({ min: 0, max: 0.5, noNaN: true }), curve }),
              })
              .map(({ source: index, a, b, gainDb, fadeIn, fadeOut }): AudioClip => {
                const length = (sources[index] as number[][])[0]?.length ?? 1;
                const start = a % length;
                const end = start + 1 + (b % (length - start));
                const frames = end - start;
                return {
                  key: "",
                  source: `s${index}`,
                  start,
                  end,
                  gainDb,
                  fadeIn: { frames: Math.floor(fadeIn.share * frames), curve: fadeIn.curve },
                  fadeOut: { frames: Math.floor(fadeOut.share * frames), curve: fadeOut.curve },
                };
              }),
            { maxLength: 4 },
          )
          .map((clips) => ({
            sources,
            sampleFormat,
            plan: plan(
              clips.map((each, index) => ({ ...each, key: `c${index}` })),
              channels,
            ),
          })),
      );
    const shared = processor();
    await fc.assert(
      fc.asyncProperty(job, async ({ sources, sampleFormat, plan: rendered }) => {
        const decoded = new Map(
          sources.map((channels, index) => [`s${index}`, memoryAudio(8_000, channels)]),
        );
        const output = await shared.render({
          plan: rendered,
          sources: decoded,
          format: { container: "wav", sampleFormat },
        });
        const read = await inspectWav(output).catch(() => undefined);
        if (rendered.clips.length === 0) return;
        const expected = Array.from({ length: rendered.channels }, () => [] as number[]);
        for (const each of rendered.clips) {
          const audio = decoded.get(each.source) as ReturnType<typeof memoryAudio>;
          const matrix = channelMix(audio.numberOfChannels, rendered.channels);
          for (let i = 0; i < clipLength(each); i += 1) {
            for (let out = 0; out < rendered.channels; out += 1) {
              let mixed = 0;
              for (let input = 0; input < audio.numberOfChannels; input += 1) {
                mixed +=
                  (matrix[out]?.[input] as number) *
                  (audio.getChannelData(input)[each.start + i] as number);
              }
              expected[out]?.push(stored(Math.fround(mixed * gainAt(each, i)), sampleFormat));
            }
          }
        }
        expect(read?.channels.map((channel) => [...channel])).toEqual(expected);
      }),
      { numRuns: 60, seed: 2_026 },
    );
    await shared.destroy();
  });
});
