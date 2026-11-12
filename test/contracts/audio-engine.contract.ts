import { describe, expect, it } from "vitest";
import { type AudioEngine, isAudioError } from "../../src/index.js";

/**
 * What an engine's contract test needs: a way to create the engine and
 * files to read. The SDK's adapter supplies real WAV and compressed files;
 * the fakes supply fake ones.
 */
export interface AudioEngineHarness {
  createEngine(): AudioEngine;
  /** A file holding exactly these samples, one array per channel. */
  file(sampleRate: number, channels: readonly (readonly number[])[]): Promise<Blob>;
  /** A file whose header declares more frames than its packets carry. */
  lyingHeader(): Promise<Blob>;
  /**
   * A file that decodes to a few frames more than its bound, within the
   * tolerance. Omitted for engines whose decoders can't return more than
   * the bound, such as the uncompressed parser.
   */
  readonly slightlyLong?: () => Promise<Blob>;
  /** A file that decodes to more than its bound plus the tolerance. Omitted as above. */
  readonly overlong?: () => Promise<Blob>;
  /** A file in a recognised container that's malformed. */
  malformed(): Promise<Blob>;
  /** A file in a container the engine doesn't recognise. */
  unknown(): Promise<Blob>;
  /** How far a decoded sample may be from the original: 0 for lossless fixtures. */
  readonly sampleTolerance: number;
}

const RATE = 8_000;
const LEFT = Array.from({ length: 1_000 }, (_, i) => Math.sin(i / 10) * 0.5);
const RIGHT = LEFT.map((sample) => -sample);

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to reject");
}

function aborted(): AbortSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}

/**
 * The behaviour every {@link AudioEngine} must have (ADR 0001, ADR 0004,
 * ADR 0008). Adapters run it with their own harness.
 */
export function describeAudioEngineContract(name: string, harness: AudioEngineHarness): void {
  describe(`${name}: the AudioEngine contract`, () => {
    it("probes a file's format and bound without decoding it", async () => {
      const engine = harness.createEngine();
      const probe = await engine.probe(await harness.file(RATE, [LEFT, RIGHT]));
      expect(probe).toMatchObject({ sampleRate: RATE, channels: 2 });
      expect(probe.frameBound).toBeGreaterThanOrEqual(LEFT.length);
      expect(probe.expectedFrames).toBeLessThanOrEqual(probe.frameBound);
      expect(probe.frameTolerance).toBeGreaterThanOrEqual(0);
      await engine.destroy();
    });

    it("decodes at the probe's rate and channel count, sample for sample", async () => {
      const engine = harness.createEngine();
      const file = await harness.file(RATE, [LEFT, RIGHT]);
      const audio = await engine.decode(file, await engine.probe(file));
      expect(audio).toMatchObject({ sampleRate: RATE, numberOfChannels: 2, length: LEFT.length });
      const tolerance = harness.sampleTolerance + 1e-7;
      for (const [channel, expected] of [LEFT, RIGHT].entries()) {
        const data = audio.getChannelData(channel);
        for (let i = 0; i < expected.length; i += 1) {
          expect(Math.abs((data[i] ?? Number.NaN) - (expected[i] ?? 0))).toBeLessThanOrEqual(
            tolerance,
          );
        }
      }
      await engine.destroy();
    });

    it("reports progress that ends at 1", async () => {
      const engine = harness.createEngine();
      const file = await harness.file(RATE, [LEFT]);
      const progress: number[] = [];
      await engine.decode(file, await engine.probe(file), {
        onProgress: (fraction) => progress.push(fraction),
      });
      expect(progress.at(-1)).toBe(1);
      expect(progress).toEqual([...progress].sort((a, b) => a - b));
      await engine.destroy();
    });

    it("rejects a header that claims more than the packets carry, before decoding", async () => {
      const engine = harness.createEngine();
      const error = await rejection(engine.probe(await harness.lyingHeader()));
      expect(isAudioError(error, "INVALID_AUDIO")).toBe(true);
      await engine.destroy();
    });

    it.runIf(harness.slightlyLong)(
      "accepts a decode within the tolerance, capped at the bound",
      async () => {
        const engine = harness.createEngine();
        const file = await (harness.slightlyLong as () => Promise<Blob>)();
        const probe = await engine.probe(file);
        const audio = await engine.decode(file, probe);
        expect(audio.length).toBeLessThanOrEqual(probe.frameBound);
        await engine.destroy();
      },
    );

    it.runIf(harness.overlong)(
      "rejects a decode longer than the bound plus the tolerance",
      async () => {
        const engine = harness.createEngine();
        const file = await (harness.overlong as () => Promise<Blob>)();
        const error = await rejection(engine.decode(file, await engine.probe(file)));
        expect(isAudioError(error, "INVALID_AUDIO")).toBe(true);
        await engine.destroy();
      },
    );

    it("fails malformed and unknown files with their codes", async () => {
      const engine = harness.createEngine();
      expect(
        isAudioError(await rejection(engine.probe(await harness.malformed())), "INVALID_AUDIO"),
      ).toBe(true);
      expect(
        isAudioError(await rejection(engine.probe(await harness.unknown())), "UNSUPPORTED_FORMAT"),
      ).toBe(true);
      await engine.destroy();
    });

    it("rejects aborted calls with ABORTED", async () => {
      const engine = harness.createEngine();
      const file = await harness.file(RATE, [LEFT]);
      const probe = await engine.probe(file);
      expect(
        isAudioError(await rejection(engine.probe(file, { signal: aborted() })), "ABORTED"),
      ).toBe(true);
      expect(
        isAudioError(await rejection(engine.decode(file, probe, { signal: aborted() })), "ABORTED"),
      ).toBe(true);
      await engine.destroy();
    });

    it("builds peaks from the finest level to the coarsest, matching the samples", async () => {
      const engine = harness.createEngine();
      const file = await harness.file(RATE, [LEFT, RIGHT]);
      const audio = await engine.decode(file, await engine.probe(file));
      const { levels } = await engine.peaks(audio);
      expect(levels.length).toBeGreaterThan(0);
      for (let i = 1; i < levels.length; i += 1) {
        expect(levels[i]?.framesPerBucket).toBeGreaterThan(levels[i - 1]?.framesPerBucket ?? 0);
      }
      const finest = levels[0];
      if (!finest) throw new Error("no levels");
      const left = audio.getChannelData(0);
      const bucket = left.subarray(0, finest.framesPerBucket);
      expect(finest.channels).toHaveLength(2);
      expect(finest.channels[0]?.min[0]).toBeCloseTo(Math.min(...bucket), 6);
      expect(finest.channels[0]?.max[0]).toBeCloseTo(Math.max(...bucket), 6);
      expect(finest.channels[0]?.min).toHaveLength(
        Math.ceil(audio.length / finest.framesPerBucket),
      );
      await engine.destroy();
    });

    it("rejects calls after destroy", async () => {
      const engine = harness.createEngine();
      const file = await harness.file(RATE, [LEFT]);
      await engine.destroy();
      await expect(engine.probe(file)).rejects.toThrow();
    });
  });
}
