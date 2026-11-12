import { describe, expect, it } from "vitest";
import { createEngine, type WritableAudio } from "../../src/adapters/audio-engine.js";
import { blockPeaks, buildPyramid } from "../../src/adapters/peaks.js";
import { type AudioEngine, audioLimits, isAudioError } from "../../src/index.js";
import { describeAudioEngineContract } from "../contracts/audio-engine.contract.js";
import { fakeDecoded } from "../fakes/fake-audio.js";
import { wavFile } from "../fixtures/pcm-files.js";
import { wavEngineHarness } from "./engine-harness.js";
import { startInProcessWorker } from "./in-process-worker.js";

/** An `AudioBuffer` stand-in for Node. */
function memoryBuffer(options: {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
}): WritableAudio {
  const data = Array.from(
    { length: options.numberOfChannels },
    () => new Float32Array(options.length),
  );
  return {
    sampleRate: options.sampleRate,
    length: options.length,
    numberOfChannels: options.numberOfChannels,
    getChannelData: (channel) => data[channel] as Float32Array,
    copyToChannel: (source, channel, start) => (data[channel] as Float32Array).set(source, start),
  };
}

function nodeEngine(createBuffer = memoryBuffer): AudioEngine {
  return createEngine({
    loadWorker: async () => startInProcessWorker,
    createBuffer,
    idleTimeout: 0,
  });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

// The engine's own code and the worker's, in one thread.
describeAudioEngineContract(
  "audio engine (in process)",
  wavEngineHarness(() => nodeEngine()),
);

describe("the audio engine", () => {
  // More than one block of 2¹⁶ frames, so decoding streams.
  const LONG = Array.from({ length: 150_000 }, (_, i) => Math.sin(i / 50) * 0.5);
  const longFile = () => new Blob([wavFile([LONG], { format: "float32" })]);

  it("decodes in blocks, reporting progress per block", async () => {
    const engine = nodeEngine();
    const file = longFile();
    const progress: number[] = [];
    const audio = await engine.decode(file, await engine.probe(file), {
      onProgress: (fraction) => progress.push(fraction),
    });
    expect(progress).toEqual([65_536 / 150_000, 131_072 / 150_000, 1]);
    expect(audio.getChannelData(0)[149_999]).toBe(Math.fround(LONG[149_999] ?? 0));
    await engine.destroy();
  });

  it("gives the same peaks for audio it parsed as for audio it didn't", async () => {
    const engine = nodeEngine();
    const file = longFile();
    const parsed = await engine.decode(file, await engine.probe(file));
    const foreign = fakeDecoded(8_000, [parsed.getChannelData(0)]);
    const fromParse = await engine.peaks(parsed);
    const fromWorker = await engine.peaks(foreign);
    expect(fromWorker).toEqual(fromParse);
    expect(fromParse).toEqual(buildPyramid(blockPeaks([parsed.getChannelData(0)], 256)));
    await engine.destroy();
  });

  it("accepts a copy of its probe, and refuses one that describes another file", async () => {
    const engine = nodeEngine();
    const file = longFile();
    const probe = await engine.probe(file);
    await expect(engine.decode(file, structuredClone(probe))).resolves.toHaveProperty(
      "length",
      150_000,
    );
    const other = await rejection(engine.decode(file, { ...probe, frameBound: 10 }));
    expect(isAudioError(other, "INVALID_AUDIO")).toBe(true);
    await engine.destroy();
  });

  it("refuses compressed codecs until their decoders arrive, and rates the buffer can't hold", async () => {
    const engine = nodeEngine(() => {
      throw new DOMException("Unsupported rate", "NotSupportedError");
    });
    const file = longFile();
    const probe = await engine.probe(file);
    const compressed = await rejection(engine.decode(file, { ...probe, codec: "opus" }));
    expect(isAudioError(compressed, "UNSUPPORTED_FORMAT")).toBe(true);
    const rate = await rejection(engine.decode(file, probe));
    expect(isAudioError(rate, "UNSUPPORTED_FORMAT")).toBe(true);
    expect((rate as { details?: unknown }).details).toEqual({
      container: "wav",
      sampleRate: 8_000,
    });
    await engine.destroy();
  });

  it("rejects with the time limit's own code when it runs out (sdk-core ADR 0031)", async () => {
    const engine = nodeEngine();
    const file = longFile();
    const probe = await engine.probe(file);
    const controller = new AbortController();
    let limit: unknown;
    try {
      audioLimits.resolve({ maxProcessingTime: 1 }).check("maxProcessingTime", 2);
    } catch (error) {
      limit = error;
    }
    const error = await rejection(
      engine.decode(file, probe, {
        signal: controller.signal,
        onProgress: () => controller.abort(limit),
      }),
    );
    expect(isAudioError(error, "PROCESSING_TIME_EXCEEDED")).toBe(true);
    expect((error as { details?: unknown }).details).toMatchObject({ limit: "maxProcessingTime" });
    await engine.destroy();
  });

  it("never passes on the browser's own error text", async () => {
    const engine = nodeEngine(() => {
      throw new DOMException("Internal decoder detail from the browser", "NotSupportedError");
    });
    const file = longFile();
    const error = await rejection(engine.decode(file, await engine.probe(file)));
    expect((error as Error).message).not.toContain("Internal decoder detail");
    expect(JSON.stringify((error as { details?: unknown }).details)).not.toContain("Internal");
    await engine.destroy();
  });

  it("stops decoding when cancelled midway", async () => {
    const engine = nodeEngine();
    const file = longFile();
    const probe = await engine.probe(file);
    const controller = new AbortController();
    const error = await rejection(
      engine.decode(file, probe, {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    );
    expect(isAudioError(error, "ABORTED")).toBe(true);
    await engine.destroy();
  });
});
