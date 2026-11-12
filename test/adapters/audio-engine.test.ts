import { describe, expect, it } from "vitest";
import { createEngine, type WritableAudio } from "../../src/adapters/audio-engine.js";
import { blockPeaks, buildPyramid } from "../../src/adapters/peaks.js";
import {
  type PlatformDecoder,
  webAudioDecoder,
} from "../../src/adapters/web-audio/platform-decode.js";
import { type AudioEngine, audioLimits, isAudioError } from "../../src/index.js";
import { describeAudioEngineContract } from "../contracts/audio-engine.contract.js";
import { fakeDecoded } from "../fakes/fake-audio.js";
import { flacFile } from "../fixtures/flac-files.js";
import { adtsFile } from "../fixtures/mpeg-files.js";
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

/** Node has no Web Audio: tests that decode compressed files pass their own decoder. */
const noPlatformDecoder: PlatformDecoder = webAudioDecoder;

function nodeEngine(
  createBuffer = memoryBuffer,
  decodePlatform: PlatformDecoder = noPlatformDecoder,
): AudioEngine {
  return createEngine({
    loadWorker: async () => startInProcessWorker,
    createBuffer,
    decodePlatform,
    idleTimeout: 0,
    version: __AUDIO_SDK_VERSION__,
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

  it("refuses a probe whose codec doesn't match the file, and rates the buffer can't hold", async () => {
    const engine = nodeEngine(() => {
      throw new DOMException("Unsupported rate", "NotSupportedError");
    });
    const file = longFile();
    const probe = await engine.probe(file);
    // A WAV file passed off as Opus is probed again, and refused.
    const forged = await rejection(engine.decode(file, { ...probe, codec: "opus" }));
    expect(isAudioError(forged, "INVALID_AUDIO")).toBe(true);
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

  it("refuses a worker built from another version, naming it", async () => {
    // As a self-hosted worker left over from before an upgrade would be.
    const engine = createEngine({
      loadWorker: async () => startInProcessWorker,
      createBuffer: memoryBuffer,
      decodePlatform: noPlatformDecoder,
      idleTimeout: 0,
      version: "9.9.9",
      asset: "https://example.test/assets/audio/audio.worker.js",
    });
    const error = await rejection(engine.probe(longFile()));
    expect(isAudioError(error, "WORKER_START_FAILED")).toBe(true);
    expect((error as { details?: unknown }).details).toEqual({
      asset: "https://example.test/assets/audio/audio.worker.js",
      expected: "9.9.9",
      actual: __AUDIO_SDK_VERSION__,
    });
    await engine.destroy();
  });

  it("opens a truncated WAV with the frames it holds, passing on what its header declared", async () => {
    const engine = nodeEngine();
    const bytes = wavFile([LONG], { format: "float32" });
    const file = new Blob([bytes.slice(0, bytes.length - 4 * 50_000)]);
    const probe = await engine.probe(file);
    expect(probe).toMatchObject({ frameBound: 100_000, declaredFrames: 150_000 });
    const audio = await engine.decode(file, probe);
    expect(audio.length).toBe(100_000);
    expect(audio.getChannelData(0)[99_999]).toBe(Math.fround(LONG[99_999] ?? 0));
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

describe("decoding compressed files on the page (sdk-core ADR 0031)", () => {
  const TONE = Array.from({ length: 5_000 }, (_, i) => Math.sin(i / 11) * 0.5);
  const flac = () => new Blob([flacFile([TONE, TONE], { sampleRate: 48_000, blockSize: 1_000 })]);

  /** A decoder that returns `length` frames of silence in the requested format. */
  const returning =
    (length: number, override: { channels?: number; sampleRate?: number } = {}): PlatformDecoder =>
    async (_bytes, format) =>
      memoryBuffer({
        numberOfChannels: override.channels ?? format.channels,
        length,
        sampleRate: override.sampleRate ?? format.sampleRate,
      });

  it("decodes a probed file with the platform decoder, at the probe's format", async () => {
    const seen: { bytes: number; sampleRate: number; channels: number }[] = [];
    const engine = nodeEngine(memoryBuffer, async (bytes, format) => {
      seen.push({ bytes: bytes.byteLength, ...format });
      return returning(5_000)(bytes, format);
    });
    const file = flac();
    const progress: number[] = [];
    const audio = await engine.decode(file, await engine.probe(file), {
      onProgress: (fraction) => progress.push(fraction),
    });
    expect(audio).toMatchObject({ length: 5_000, numberOfChannels: 2, sampleRate: 48_000 });
    expect(seen).toEqual([{ bytes: file.size, sampleRate: 48_000, channels: 2 }]);
    expect(progress).toEqual([1]);
    await engine.destroy();
  });

  it("gives the decoder a fresh buffer it may detach", async () => {
    const engine = nodeEngine(memoryBuffer, async (bytes, format) => {
      structuredClone(bytes, { transfer: [bytes] }); // detaches it, as decodeAudioData does
      return returning(5_000)(new ArrayBuffer(0), format);
    });
    const file = flac();
    const probe = await engine.probe(file);
    await engine.decode(file, probe);
    // The file is untouched, so it decodes again.
    await expect(engine.decode(file, probe)).resolves.toHaveProperty("length", 5_000);
    await engine.destroy();
  });

  it("shortens output within the tolerance to the bound, and refuses output beyond it", async () => {
    const file = flac();
    const within = nodeEngine(memoryBuffer, returning(5_000 + 1_000));
    const capped = await within.decode(file, await within.probe(file));
    expect(capped.length).toBe(5_000);
    await within.destroy();

    const beyond = nodeEngine(memoryBuffer, returning(5_000 + 1_001));
    const error = await rejection(beyond.decode(file, await beyond.probe(file)));
    expect(isAudioError(error, "INVALID_AUDIO")).toBe(true);
    expect((error as { details?: unknown }).details).toEqual({
      container: "flac",
      codec: "flac",
      reason: "decoded length exceeds the bound",
    });
    await beyond.destroy();
  });

  it("refuses output in another channel count or rate", async () => {
    const file = flac();
    for (const decoder of [
      returning(5_000, { channels: 8 }),
      returning(5_000, { sampleRate: 8_000 }),
    ]) {
      const engine = nodeEngine(memoryBuffer, decoder);
      const error = await rejection(engine.decode(file, await engine.probe(file)));
      expect(isAudioError(error, "INVALID_AUDIO")).toBe(true);
      await engine.destroy();
    }
  });

  it("accepts fewer channels than the probe allows, as for mono AAC without parametric stereo", async () => {
    const engine = nodeEngine(memoryBuffer, returning(20 * 1_024, { channels: 1 }));
    const file = new Blob([adtsFile(20, { sampleRate: 48_000, channelConfiguration: 1 })]);
    const probe = await engine.probe(file);
    expect(probe.channels).toBe(2);
    await expect(engine.decode(file, probe)).resolves.toHaveProperty("numberOfChannels", 1);
    await engine.destroy();
  });

  it("treats a decode that returns no audio as a failure", async () => {
    const engine = nodeEngine(memoryBuffer, returning(0));
    const file = flac();
    const error = await rejection(engine.decode(file, await engine.probe(file)));
    expect(isAudioError(error, "DECODE_FAILED")).toBe(true);
    await engine.destroy();
  });

  it("reports a decoder failure by code, never with the browser's text", async () => {
    const engine = nodeEngine(memoryBuffer, async () => {
      throw new DOMException("Internal FFmpeg detail: invalid residual", "EncodingError");
    });
    const file = flac();
    const error = await rejection(engine.decode(file, await engine.probe(file)));
    expect(isAudioError(error, "DECODE_FAILED")).toBe(true);
    expect((error as { details?: unknown }).details).toEqual({ container: "flac", codec: "flac" });
    expect((error as Error).message).not.toContain("FFmpeg");
    await engine.destroy();
  });

  it("stops waiting for a decoder that never settles when the time limit runs out, and drops its late result", async () => {
    let finish: (audio: ReturnType<typeof memoryBuffer>) => void = () => {};
    const engine = nodeEngine(
      memoryBuffer,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const file = flac();
    const probe = await engine.probe(file);
    let limit: unknown;
    try {
      audioLimits.resolve({ maxProcessingTime: 1 }).check("maxProcessingTime", 2);
    } catch (error) {
      limit = error;
    }
    const controller = new AbortController();
    const decoding = engine.decode(file, probe, { signal: controller.signal });
    setTimeout(() => controller.abort(limit), 20);
    const error = await rejection(decoding);
    expect(isAudioError(error, "PROCESSING_TIME_EXCEEDED")).toBe(true);
    // The decoder finishes later: nothing happens, and nothing is reported.
    finish(memoryBuffer({ numberOfChannels: 2, length: 5_000, sampleRate: 48_000 }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await engine.destroy();
  });

  it("refuses to run without Web Audio, naming the missing feature", async () => {
    const engine = nodeEngine(memoryBuffer, webAudioDecoder);
    const file = flac();
    const error = await rejection(engine.decode(file, await engine.probe(file)));
    expect(isAudioError(error, "UNSUPPORTED_ENVIRONMENT")).toBe(true);
    expect((error as { details?: unknown }).details).toEqual({ feature: "OfflineAudioContext" });
    await engine.destroy();
  });

  it("decodes only files it probed itself: a copied probe is checked against the file", async () => {
    const engine = nodeEngine(memoryBuffer, returning(5_000));
    const file = flac();
    const probe = await engine.probe(file);
    await expect(engine.decode(file, structuredClone(probe))).resolves.toHaveProperty(
      "length",
      5_000,
    );
    const forged = await rejection(engine.decode(file, { ...probe, frameBound: 50_000_000 }));
    expect(isAudioError(forged, "INVALID_AUDIO")).toBe(true);
    await engine.destroy();
  });
});
