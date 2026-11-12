import { describe, expect, it } from "vitest";
import { flacFile, flacFrame, oggFlacFile, oggPage } from "../../../test/fixtures/flac-files.js";
import { isAudioError } from "../../core/errors/audio-error.js";
import { crc8, crc16Step, crc32 } from "../bytes/crc.js";
import { probeFile } from "../probe.js";
import { readFrameHeader, skipId3v2 } from "./flac.js";

const TONE = Array.from({ length: 1_000 }, (_, i) => Math.sin(i / 7) * 0.6);
const blob = (bytes: Uint8Array<ArrayBuffer>) => new Blob([bytes]);

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a failure");
}

async function reason(promise: Promise<unknown>): Promise<unknown> {
  const error = await failure(promise);
  expect(isAudioError(error, "INVALID_AUDIO")).toBe(true);
  return (error as { details?: { reason?: unknown } }).details?.reason;
}

describe("the CRCs", () => {
  const check = new TextEncoder().encode("123456789");
  it("match their published check values", () => {
    expect(crc8(check)).toBe(0xf4);
    let crc = 0;
    for (const byte of check) crc = crc16Step(crc, byte);
    expect(crc).toBe(0xfee8);
    expect(crc32(check)).toBe(0x89a1897f);
  });
});

describe("FLAC frame headers", () => {
  it("reads a valid header, and rejects one with a wrong CRC-8 or a reserved value", () => {
    const frame = Uint8Array.from(flacFrame([TONE, TONE], 0, 64, 0));
    expect(readFrameHeader(frame, 0)).toEqual({
      blockSize: 64,
      sampleRate: undefined,
      channels: 2,
      length: 8,
    });
    const badCrc = frame.slice();
    badCrc[7] = (badCrc[7] as number) ^ 1;
    expect(readFrameHeader(badCrc, 0)).toBeUndefined();
    const reserved = frame.slice();
    reserved[3] = (reserved[3] as number) | 1;
    expect(readFrameHeader(reserved, 0)).toBeUndefined();
    expect(readFrameHeader(frame.subarray(0, 5), 0)).toBeUndefined();
  });

  it("skips an ID3v2 tag", () => {
    expect(skipId3v2(Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 1, 0]))).toBe(10 + 128);
    expect(skipId3v2(Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0x10, 0, 0, 0, 5]))).toBe(25);
    expect(skipId3v2(Uint8Array.from([0x66, 0x4c, 0x61, 0x43]))).toBe(0);
  });
});

describe("native FLAC", () => {
  it("bounds the stream by its frames, with STREAMINFO's total as the expected length", async () => {
    const { probe } = await probeFile(blob(flacFile([TONE, TONE], { sampleRate: 44_100 })));
    expect(probe).toEqual({
      container: "flac",
      codec: "flac",
      sampleRate: 44_100,
      channels: 2,
      frameBound: 1_000,
      expectedFrames: 1_000,
      frameTolerance: 64,
    });
  });

  it("finds the stream after an ID3v2 tag, and uses the bound when the total is unknown", async () => {
    const { probe } = await probeFile(blob(flacFile([TONE], { id3: true, totalFrames: 0 })));
    expect(probe).toMatchObject({ frameBound: 1_000, expectedFrames: 1_000 });
  });

  it("refuses a STREAMINFO total that claims more than the frames carry", async () => {
    expect(await reason(probeFile(blob(flacFile([TONE], { totalFrames: 10_000_000 }))))).toBe(
      "STREAMINFO claims more than the frames carry",
    );
  });

  it("refuses real frames that disagree with STREAMINFO", async () => {
    // Every frame says 48 kHz, and each one's CRC-16 verifies, so they're real.
    expect(await reason(probeFile(blob(flacFile([TONE], { frameRateCode: 10 }))))).toBe(
      "a frame's sample rate differs from STREAMINFO",
    );
    expect(await reason(probeFile(blob(flacFile([TONE, TONE], { streamInfoChannels: 1 }))))).toBe(
      "a frame's channel count differs from STREAMINFO",
    );
  });

  it("counts a false frame sync in the audio data without failing", async () => {
    // A frame header's bytes copied into the samples: a sync with a valid
    // CRC-8, but no frame behind it, so its CRC-16 never verifies.
    const bytes = flacFile([TONE]);
    const fake = flacFrame([TONE], 0, 4_096, 99, { frameRateCode: 10 }).slice(0, 8);
    const inside = bytes.length - 40;
    bytes.set(fake, inside);
    const { probe } = await probeFile(blob(bytes));
    // Counted, not trusted: the bound grows by its 4,096 frames, and its
    // mismatched sample rate doesn't fail the file.
    expect(probe.frameBound).toBe(1_000 + 4_096);
  });

  it("refuses a file with no frames, or a broken metadata chain", async () => {
    expect(await reason(probeFile(blob(flacFile([[]]))))).toBe("no audio frames");
    const broken = flacFile([TONE]);
    broken[4] = 0x01; // the first block isn't STREAMINFO
    expect(await reason(probeFile(blob(broken)))).toBe("STREAMINFO isn't first");
  });
});

describe("FLAC in Ogg", () => {
  it("bounds the stream by its packets, with the last granule as the expected length", async () => {
    const { probe } = await probeFile(blob(oggFlacFile([TONE, TONE], { sampleRate: 48_000 })));
    expect(probe).toEqual({
      container: "ogg",
      codec: "flac",
      sampleRate: 48_000,
      channels: 2,
      frameBound: 1_000,
      expectedFrames: 1_000,
      frameTolerance: 64,
    });
  });

  it("refuses a granule position or STREAMINFO total beyond the packets", async () => {
    expect(await reason(probeFile(blob(oggFlacFile([TONE], { lastGranule: 5_000_000 }))))).toBe(
      "a declared length exceeds the frames",
    );
    expect(await reason(probeFile(blob(oggFlacFile([TONE], { totalFrames: 5_000_000 }))))).toBe(
      "a declared length exceeds the frames",
    );
  });

  it("refuses frames that disagree with STREAMINFO", async () => {
    expect(await reason(probeFile(blob(oggFlacFile([TONE], { frameRateCode: 10 }))))).toBe(
      "a frame's sample rate differs from STREAMINFO",
    );
  });

  it("refuses a second logical stream", async () => {
    const error = await failure(probeFile(blob(oggFlacFile([TONE], { multiplexed: true }))));
    expect(isAudioError(error, "UNSUPPORTED_FORMAT")).toBe(true);
  });

  it("counts a packet whose header doesn't parse as STREAMINFO's largest block", async () => {
    const bytes = oggFlacFile([TONE]);
    // The last frame holds 40 frames and is the file's last bytes. Corrupt its
    // header's CRC-8: the packet still counts, as the largest block, 64.
    const last = flacFrame([TONE], 960, 40, 15);
    const header = bytes.length - last.length;
    expect(bytes.subarray(header, header + 2)).toEqual(Uint8Array.of(0xff, 0xf8));
    bytes[header + 7] = (bytes[header + 7] as number) ^ 0xff;
    const { probe } = await probeFile(blob(bytes));
    expect(probe.frameBound).toBe(960 + 64);
  });

  it("leaves Ogg streams of other codecs to their own readers", async () => {
    const vorbis = Uint8Array.from(
      oggPage([[1, ...new TextEncoder().encode("vorbis")]], {
        serial: 1,
        sequence: 0,
        granule: 0,
        type: 2,
      }),
    );
    const error = await failure(probeFile(blob(vorbis)));
    expect(isAudioError(error, "UNSUPPORTED_FORMAT")).toBe(true);
  });
});
