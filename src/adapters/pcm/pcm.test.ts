import { describe, expect, it } from "vitest";
import { aiffFile, extended, type WavFormat, wavFile } from "../../../test/fixtures/pcm-files.js";
import { isAudioError } from "../../core/errors/audio-error.js";
import { readExtended } from "./aiff.js";
import { probePcm, readPcmFrames } from "./probe.js";

const LEFT = [0, 0.25, -0.5, 0.75, -1, 0.5, 0.125];
const RIGHT = LEFT.map((sample) => -sample);

const blob = (bytes: Uint8Array<ArrayBuffer>) => new Blob([bytes]);

async function readAll(bytes: Uint8Array<ArrayBuffer>) {
  const file = blob(bytes);
  const { probe, layout } = await probePcm(file);
  return { probe, layout, channels: await readPcmFrames(file, layout, 0, layout.frames) };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a failure");
}

/** The step between neighbouring values of each format: how close a sample comes back. */
const STEP: Record<WavFormat, number> = {
  pcm8: 1 / 128,
  pcm16: 1 / 32_768,
  pcm24: 1 / 8_388_608,
  pcm32: 1 / 2_147_483_648,
  float32: 0,
  float64: 0,
};

function expectClose(actual: Float32Array | undefined, expected: number[], step: number) {
  expect(actual).toHaveLength(expected.length);
  for (const [i, value] of expected.entries()) {
    expect(Math.abs((actual?.[i] ?? Number.NaN) - value), `sample ${i}`).toBeLessThanOrEqual(
      step + 1e-7,
    );
  }
}

describe("WAV", () => {
  it.each(Object.keys(STEP) as WavFormat[])("reads %s samples, per channel", async (format) => {
    const { probe, channels } = await readAll(
      wavFile([LEFT, RIGHT], { format, sampleRate: 44_100 }),
    );
    expect(probe).toEqual({
      container: "wav",
      codec: "pcm",
      sampleRate: 44_100,
      channels: 2,
      frameBound: LEFT.length,
      expectedFrames: LEFT.length,
      frameTolerance: 0,
    });
    expectClose(channels[0], LEFT, STEP[format]);
    expectClose(channels[1], RIGHT, STEP[format]);
  });

  it("reads extensible, RF64, padded and reordered files", async () => {
    for (const options of [
      { extensible: true, format: "pcm24" as const },
      { extensible: true, format: "float32" as const },
      { rf64: true },
      { oddChunk: true },
      { dataFirst: true },
    ]) {
      const { channels } = await readAll(wavFile([LEFT], options));
      expectClose(channels[0], LEFT, 1 / 8_000);
    }
  });

  it("reads to the end of the file when the data size is unknown, as when streaming", async () => {
    for (const dataSize of [0, 0xffffffff]) {
      const { probe } = await readAll(wavFile([LEFT], { dataSize }));
      expect(probe.frameBound).toBe(LEFT.length);
    }
  });

  it("refuses a data size larger than the file", async () => {
    const error = await failure(probePcm(blob(wavFile([LEFT], { dataSize: 1_000_000 }))));
    expect(isAudioError(error, "INVALID_AUDIO")).toBe(true);
    expect((error as { details?: unknown }).details).toEqual({
      container: "wav",
      reason: "data size exceeds the file",
    });
  });

  it("refuses compressed formats inside WAV, and files with no frames", async () => {
    const mp3InWav = await failure(probePcm(blob(wavFile([LEFT], { formatTag: 0x55 }))));
    expect(isAudioError(mp3InWav, "UNSUPPORTED_FORMAT")).toBe(true);
    const empty = await failure(probePcm(blob(wavFile([[]]))));
    expect(isAudioError(empty, "INVALID_AUDIO")).toBe(true);
  });

  it("turns non-finite float samples into silence", async () => {
    const bytes = wavFile([[0.5, 0.5, 0.5]], { format: "float32" });
    const view = new DataView(bytes.buffer);
    const dataStart = bytes.length - 12;
    view.setFloat32(dataStart, Number.NaN, true);
    view.setFloat32(dataStart + 4, Number.POSITIVE_INFINITY, true);
    const { channels } = await readAll(bytes);
    expect([...(channels[0] ?? [])]).toEqual([0, 0, 0.5]);
  });

  it("turns 64-bit floats too large for 32 bits into silence, keeping overs", async () => {
    const bytes = wavFile([[0.5, 0.5, 0.5]], { format: "float64" });
    const view = new DataView(bytes.buffer);
    const dataStart = bytes.length - 24;
    view.setFloat64(dataStart, 1e300, true);
    view.setFloat64(dataStart + 8, 4, true);
    const { channels } = await readAll(bytes);
    expect([...(channels[0] ?? [])]).toEqual([0, 4, 0.5]);
  });

  it("gives up on a file of endless chunks, even when valid chunks follow", async () => {
    const valid = wavFile([LEFT]);
    const junk = Array.from({ length: 1_100 }, () => [
      ...new TextEncoder().encode("junk"),
      0,
      0,
      0,
      0,
    ]);
    // RIFF header, then the junk, then the valid file's own fmt and data chunks.
    const file = Uint8Array.from([...valid.slice(0, 12), ...junk.flat(), ...valid.slice(12)]);
    const error = await failure(probePcm(blob(file)));
    expect(isAudioError(error, "INVALID_AUDIO")).toBe(true);
    expect((error as { details?: unknown }).details).toEqual({
      container: "wav",
      reason: "too many chunks",
    });
  });
});

describe("AIFF", () => {
  it.each([
    ["AIFF", 8],
    ["AIFF", 16],
    ["AIFF", 24],
    ["AIFF", 32],
    ["NONE", 16],
    ["sowt", 16],
    ["fl32", 32],
    ["fl64", 64],
  ] as const)("reads %s at %i bits", async (type, bits) => {
    const options = type === "fl32" || type === "fl64" ? { type } : { type, bits: bits as 8 };
    const { probe, channels } = await readAll(
      aiffFile([LEFT, RIGHT], { ...options, sampleRate: 48_000 }),
    );
    expect(probe).toMatchObject({
      container: "aiff",
      sampleRate: 48_000,
      channels: 2,
      frameBound: 7,
    });
    const step = type.startsWith("fl") ? 0 : 2 ** -(bits - 1);
    expectClose(channels[0], LEFT, step);
    expectClose(channels[1], RIGHT, step);
  });

  it("refuses a frame count larger than the sound data", async () => {
    const error = await failure(probePcm(blob(aiffFile([LEFT], { frames: 1_000_000 }))));
    expect(isAudioError(error, "INVALID_AUDIO")).toBe(true);
  });

  it("reads 80-bit sample rates, and refuses nonsense ones", () => {
    for (const rate of [8_000, 22_050, 44_100, 48_000, 96_000, 192_000]) {
      expect(readExtended(new DataView(Uint8Array.from(extended(rate)).buffer), 0)).toBe(rate);
    }
    expect(readExtended(new DataView(new Uint8Array(10).buffer), 0)).toBeNaN();
    const infinite = Uint8Array.from([0x7f, 0xff, 0x80, 0, 0, 0, 0, 0, 0, 0]);
    expect(readExtended(new DataView(infinite.buffer), 0)).toBeNaN();
  });
});

describe("probePcm", () => {
  it("fails closed for anything that isn't WAV or AIFF", async () => {
    for (const bytes of [new TextEncoder().encode("OggS\0\0\0\0\0\0\0\0"), new Uint8Array(3)]) {
      const error = await failure(probePcm(blob(bytes)));
      expect(isAudioError(error, "UNSUPPORTED_FORMAT")).toBe(true);
    }
  });

  it("reads a range of frames, and refuses one outside the file", async () => {
    const file = blob(wavFile([LEFT], { format: "float32" }));
    const { layout } = await probePcm(file);
    const [middle] = await readPcmFrames(file, layout, 2, 3);
    expect([...(middle ?? [])]).toEqual([-0.5, 0.75, -1]);
    await expect(readPcmFrames(file, layout, 5, 3)).rejects.toThrow(RangeError);
  });

  it("fails with INVALID_AUDIO when the file shrank after it was probed", async () => {
    const bytes = wavFile([LEFT], { format: "float32" });
    const { layout } = await probePcm(blob(bytes));
    const error = await failure(readPcmFrames(blob(bytes.slice(0, -8)), layout, 0, layout.frames));
    expect(isAudioError(error, "INVALID_AUDIO")).toBe(true);
  });
});
