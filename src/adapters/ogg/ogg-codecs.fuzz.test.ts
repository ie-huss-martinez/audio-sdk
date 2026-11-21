import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { oggPage } from "../../../test/fixtures/flac-files.js";
import { oggOpusFile, oggVorbisFile } from "../../../test/fixtures/ogg-files.js";
import { isAudioError } from "../../core/errors/audio-error.js";
import { probeFile } from "../probe.js";

/**
 * The Opus and Vorbis walkers are hostile-input code (docs/adr/0001): on any
 * bytes, they must settle quickly with a probe whose expected length is
 * within its bound, or with `INVALID_AUDIO` or `UNSUPPORTED_FORMAT`, and
 * never hang or throw anything else.
 */

const SETTLE_MS = 1_000;

const FIXTURES: Record<string, Uint8Array<ArrayBuffer>> = {
  "Opus, stereo": oggOpusFile({ packets: 12 }),
  "Opus, mono, no pre-skip": oggOpusFile({ packets: 7, channels: 1, preSkip: 0 }),
  "Vorbis, 2,048-sample blocks": oggVorbisFile({ packets: 9 }),
  "Vorbis, 8,192-sample blocks, mono": oggVorbisFile({
    packets: 4,
    channels: 1,
    blocksizes: [6, 13],
  }),
};

type Outcome = "probed" | "INVALID_AUDIO" | "UNSUPPORTED_FORMAT";
const SETTLED = ["probed", "INVALID_AUDIO", "UNSUPPORTED_FORMAT"];

async function outcome(bytes: Uint8Array<ArrayBuffer>): Promise<Outcome> {
  const attempt = (async (): Promise<Outcome> => {
    try {
      const { probe } = await probeFile(new Blob([bytes]));
      expect(probe.frameBound).toBeGreaterThan(0);
      expect(probe.expectedFrames).toBeLessThanOrEqual(probe.frameBound);
      expect(probe.channels).toBeGreaterThanOrEqual(1);
      expect(probe.sampleRate).toBeGreaterThan(0);
      return "probed";
    } catch (error) {
      if (isAudioError(error, "INVALID_AUDIO")) return "INVALID_AUDIO";
      if (isAudioError(error, "UNSUPPORTED_FORMAT")) return "UNSUPPORTED_FORMAT";
      throw error;
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`didn't settle within ${SETTLE_MS} ms`)), SETTLE_MS);
  });
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

describe("the Opus and Vorbis walkers on hostile input", () => {
  it.each(Object.entries(FIXTURES))("probe every fixture: %s", async (_, bytes) => {
    expect(await outcome(bytes)).toBe("probed");
  });

  it.each(Object.entries(FIXTURES))("settle on every truncation of %s", async (_, bytes) => {
    for (let length = 0; length < bytes.length; length += 1) {
      expect(SETTLED).toContain(await outcome(bytes.slice(0, length)));
    }
  });

  it("settle on a valid first page followed by random packets", async () => {
    const first = fc.constantFrom(
      [..."OpusHead"]
        .map((c) => c.charCodeAt(0))
        .concat([1, 2, 0x38, 1, 0x80, 0xbb, 0, 0, 0, 0, 0]),
      [0x01, ..."vorbis"]
        .map((c) => (typeof c === "number" ? c : c.charCodeAt(0)))
        .concat([
          0, 0, 0, 0, 2, 0x44, 0xac, 0, 0, 0, 0, 0, 0, 0, 0xf4, 1, 0, 0, 0, 0, 0, 0, 0xb8, 1,
        ]),
    );
    const packets = fc.array(fc.array(fc.integer({ min: 0, max: 255 }), { maxLength: 300 }), {
      maxLength: 12,
    });
    await fc.assert(
      fc.asyncProperty(first, packets, async (head, rest) => {
        const bytes = Uint8Array.from([
          ...oggPage([head], { serial: 1, sequence: 0, granule: 0, type: 2 }),
          ...oggPage(rest, { serial: 1, sequence: 1, granule: -1, type: 0 }),
        ]);
        expect(SETTLED).toContain(await outcome(bytes));
      }),
      { numRuns: 400 },
    );
  });

  it("settle on fixtures with corrupted bytes anywhere", async () => {
    const fixture = fc.constantFrom(...Object.values(FIXTURES));
    const edits = fc.array(fc.tuple(fc.nat(), fc.integer({ min: 0, max: 255 })), {
      minLength: 1,
      maxLength: 8,
    });
    await fc.assert(
      fc.asyncProperty(fixture, edits, async (original, changes) => {
        const bytes = original.slice();
        for (const [position, value] of changes) bytes[position % bytes.length] = value;
        expect(SETTLED).toContain(await outcome(bytes));
      }),
      { numRuns: 500 },
    );
  });

  it("never accept a granule position beyond the packets", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 12 * 960 + 1, max: 2 ** 40 }), async (granule) => {
        expect(await outcome(oggOpusFile({ packets: 12, lastGranule: granule }))).toBe(
          "INVALID_AUDIO",
        );
      }),
      { numRuns: 100 },
    );
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 9 * 1_024 + 1, max: 2 ** 40 }), async (granule) => {
        expect(await outcome(oggVorbisFile({ packets: 9, lastGranule: granule }))).toBe(
          "INVALID_AUDIO",
        );
      }),
      { numRuns: 100 },
    );
  });
});
