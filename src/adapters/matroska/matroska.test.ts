import { describe, expect, it } from "vitest";
import { simpleBlock, webmFile } from "../../../test/fixtures/webm-files.js";
import { probeFile } from "../probe.js";

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

describe("WebM with Opus", () => {
  it("bounds a stream by its blocks at 48 kHz, with the Duration as the expected length", async () => {
    const { probe } = await probeFile(blob(webmFile({ packets: 50, durationMs: 1_000 })));
    expect(probe).toEqual({
      container: "webm",
      codec: "opus",
      sampleRate: 48_000,
      channels: 2,
      frameBound: 50 * 960,
      expectedFrames: 48_000,
      frameTolerance: 5_760,
    });
  });

  it("walks MediaRecorder's shape: unknown-size Segment and Clusters, and no Duration", async () => {
    const { probe } = await probeFile(
      blob(webmFile({ packets: 95, unknownSizes: true, blocksPerCluster: 7 })),
    );
    expect(probe).toMatchObject({ frameBound: 95 * 960, expectedFrames: 95 * 960 });
  });

  it.each(["xiph", "ebml", "fixed"] as const)(
    "counts every frame of %s-laced blocks",
    async (lacing) => {
      const { probe } = await probeFile(blob(webmFile({ packets: 37, lacing, framesPerBlock: 5 })));
      expect(probe.frameBound).toBe(37 * 960);
    },
  );

  it("counts EBML lacing with frames of different sizes", async () => {
    const sizes = [3, 9, 4, 30, 7];
    const packets = sizes.map((size) => [0xfc, ...new Array(size - 1).fill(0xff)]);
    const { probe } = await probeFile(
      blob(webmFile({ packets: 0, customPackets: packets, lacing: "ebml", framesPerBlock: 5 })),
    );
    expect(probe.frameBound).toBe(5 * 960);
  });

  it("ignores a video track's blocks", async () => {
    const { probe } = await probeFile(
      blob(webmFile({ packets: 20, videoTrack: true, unknownSizes: true })),
    );
    expect(probe.frameBound).toBe(20 * 960);
  });

  it("counts crafted packets that claim 120 ms at 120 ms", async () => {
    const crafted = Array.from({ length: 6 }, () => [(31 << 3) | 3, 6]);
    const { probe } = await probeFile(blob(webmFile({ packets: 0, customPackets: crafted })));
    expect(probe.frameBound).toBe(6 * 5_760);
  });

  it("refuses a Duration that claims more than the blocks carry", async () => {
    expect(
      await failure(probeFile(blob(webmFile({ packets: 10, durationMs: 3_600_000 })))),
    ).toEqual({
      code: "INVALID_AUDIO",
      reason: "the Duration claims more than the blocks carry",
    });
  });

  it("refuses several audio tracks", async () => {
    expect(
      await failure(probeFile(blob(webmFile({ packets: 5, secondAudioTrack: true })))),
    ).toEqual({
      code: "UNSUPPORTED_FORMAT",
      reason: "several audio tracks",
    });
  });

  it("refuses lacing that claims more than the block holds", async () => {
    const bytes = webmFile({ packets: 8, lacing: "xiph", framesPerBlock: 4 });
    // The first block's first laced size, 3, becomes 250.
    const block = simpleBlock(
      1,
      0,
      Array.from({ length: 4 }, () => [0xfc, 0xff, 0xfe]),
      "xiph",
    );
    const at = findSequence(bytes, block);
    bytes[at + 2 + 4 + 1] = 250;
    expect(await failure(probeFile(blob(bytes)))).toEqual({
      code: "INVALID_AUDIO",
      reason: "lacing exceeds the block",
    });
  });

  it("refuses an element that overruns its Cluster", async () => {
    const bytes = webmFile({ packets: 8 });
    const block = simpleBlock(1, 0, [[0xfc, 0xff, 0xfe]], "none");
    const at = findSequence(bytes, block);
    bytes[at + 1] = 0x80 | 0x70; // the block now claims 112 bytes
    expect(await failure(probeFile(blob(bytes)))).toEqual({
      code: "INVALID_AUDIO",
      reason: "element exceeds its parent",
    });
  });
});

describe("Matroska with AAC", () => {
  it("counts every block as possibly HE-AAC, from the AudioSpecificConfig", async () => {
    // The config says 24 kHz core, so it decodes at 48 kHz, 2,048 frames a block,
    // even though the Audio element says 48,000.
    const { probe } = await probeFile(blob(webmFile({ codec: "aac", packets: 10 })));
    expect(probe).toMatchObject({
      codec: "aac",
      sampleRate: 48_000,
      channels: 2,
      frameBound: 10 * 2_048,
    });
  });

  it("refuses AAC without an AudioSpecificConfig, rather than trust the Audio element", async () => {
    expect(
      await failure(
        probeFile(blob(webmFile({ codec: "aac", packets: 10, withoutCodecPrivate: true }))),
      ),
    ).toEqual({ code: "UNSUPPORTED_FORMAT", reason: "AAC without an AudioSpecificConfig" });
  });
});

describe("WebM with Vorbis", () => {
  it("bounds every frame at half of blocksize_1, from the identification header", async () => {
    const { probe } = await probeFile(blob(webmFile({ codec: "vorbis", packets: 12 })));
    // blocksize_1 is 2^11 in the fixture.
    expect(probe).toMatchObject({
      codec: "vorbis",
      sampleRate: 44_100,
      frameBound: 12 * 1_024,
      frameTolerance: 2_048,
    });
  });
});

function findSequence(haystack: Uint8Array, needle: readonly number[]): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  throw new Error("sequence not found");
}
