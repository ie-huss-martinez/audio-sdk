import { describe, expect, it } from "vitest";
import { oggOpusFile, oggVorbisFile } from "../../../test/fixtures/ogg-files.js";
import { probeFile } from "../probe.js";
import { opusPacketSamples } from "./ogg-opus.js";

const blob = (bytes: Uint8Array<ArrayBuffer>) => new Blob([bytes]);

async function failure(
  promise: Promise<unknown>,
): Promise<{ code: string | undefined; reason: unknown }> {
  try {
    await promise;
  } catch (error) {
    return {
      code: (error as { code?: string }).code,
      reason: (error as { details?: { reason?: unknown } }).details?.reason,
    };
  }
  throw new Error("expected a failure");
}

describe("Opus packets", () => {
  it.each([
    ["CELT 20 ms, one frame", [0xf8], 960],
    ["CELT 2.5 ms, one frame", [0x80], 120],
    ["SILK 60 ms, two frames", [(3 << 3) | 1], 5_760],
    ["hybrid 10 ms, code 3 with 6 frames", [(12 << 3) | 3, 6], 2_880],
    ["code 3 claiming 48 frames of 20 ms, over 120 ms", [(31 << 3) | 3, 48], 5_760],
    ["code 3 with no frame count", [(31 << 3) | 3], 5_760],
  ] as const)("counts %s", (_, bytes, samples) => {
    expect(opusPacketSamples(Uint8Array.from(bytes), bytes.length)).toBe(samples);
  });

  it("counts an empty packet as the longest possible", () => {
    expect(opusPacketSamples(new Uint8Array(0), 0)).toBe(5_760);
  });
});

describe("Opus in Ogg", () => {
  it("bounds the stream by its packets at 48 kHz, less the pre-skip for the expected length", async () => {
    const { probe } = await probeFile(blob(oggOpusFile({ packets: 50, preSkip: 312 })));
    expect(probe).toEqual({
      container: "ogg",
      codec: "opus",
      sampleRate: 48_000,
      channels: 2,
      frameBound: 50 * 960,
      // The granule counts the pre-skip, which decoders drop.
      expectedFrames: 50 * 960 - 312,
      frameTolerance: 5_760,
    });
  });

  it("refuses a granule position beyond the packets", async () => {
    expect(
      await failure(probeFile(blob(oggOpusFile({ packets: 10, lastGranule: 10_000_000 })))),
    ).toEqual({
      code: "INVALID_AUDIO",
      reason: "a declared length exceeds the packets",
    });
  });

  it("counts crafted packets that claim more than 120 ms as 120 ms", async () => {
    const crafted = Array.from({ length: 4 }, () => [(31 << 3) | 3, 63]);
    const { probe } = await probeFile(
      blob(oggOpusFile({ packets: 0, customPackets: crafted, lastGranule: 0 })),
    );
    expect(probe.frameBound).toBe(4 * 5_760);
  });

  it("refuses channel mappings it doesn't support", async () => {
    expect(await failure(probeFile(blob(oggOpusFile({ packets: 5, mappingFamily: 255 }))))).toEqual(
      {
        code: "UNSUPPORTED_FORMAT",
        reason: "channel mapping family 255",
      },
    );
  });
});

describe("Vorbis in Ogg", () => {
  it("bounds every audio packet at half of blocksize_1, from the identification header", async () => {
    const { probe } = await probeFile(
      blob(oggVorbisFile({ packets: 30, blocksizes: [8, 11], sampleRate: 48_000 })),
    );
    expect(probe).toMatchObject({
      container: "ogg",
      codec: "vorbis",
      sampleRate: 48_000,
      channels: 2,
      frameBound: 30 * 1_024,
      frameTolerance: 2_048,
    });
    expect(probe.expectedFrames).toBeLessThanOrEqual(probe.frameBound);
  });

  it("refuses block sizes out of range, and a granule beyond the packets", async () => {
    for (const blocksizes of [
      [5, 11],
      [8, 14],
      [11, 8],
    ] as const) {
      expect(await failure(probeFile(blob(oggVorbisFile({ packets: 5, blocksizes }))))).toEqual({
        code: "INVALID_AUDIO",
        reason: "Vorbis block sizes out of range",
      });
    }
    expect(
      await failure(probeFile(blob(oggVorbisFile({ packets: 5, lastGranule: 99_999_999 })))),
    ).toEqual({
      code: "INVALID_AUDIO",
      reason: "a declared length exceeds the packets",
    });
  });

  it("refuses a stream without its setup header", async () => {
    expect(
      await failure(probeFile(blob(oggVorbisFile({ packets: 5, withoutSetup: true })))),
    ).toEqual({
      code: "INVALID_AUDIO",
      reason: "missing Vorbis comment or setup header",
    });
  });
});
