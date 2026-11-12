import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { flacFile, oggFlacFile } from "../../../test/fixtures/flac-files.js";
import { isAudioError } from "../../core/errors/audio-error.js";
import { probeFile } from "../probe.js";

/**
 * The FLAC walkers are hostile-input code (docs/adr/0001): on any bytes, they
 * must settle quickly with a probe whose expected length is within its
 * bound, or with `INVALID_AUDIO` or `UNSUPPORTED_FORMAT`, and never hang or
 * throw anything else.
 */

const SETTLE_MS = 1_000;
const TONE = Array.from({ length: 300 }, (_, i) => Math.sin(i / 5) * 0.7);

const FIXTURES: Record<string, Uint8Array<ArrayBuffer>> = {
  "native FLAC, stereo": flacFile([TONE, TONE]),
  "native FLAC after ID3v2, 24-bit": flacFile([TONE], { id3: true, bits: 24 }),
  "native FLAC, unknown total": flacFile([TONE], { totalFrames: 0, bits: 8 }),
  "FLAC in Ogg, stereo": oggFlacFile([TONE, TONE]),
  "FLAC in Ogg, 128-frame blocks": oggFlacFile([TONE], { blockSize: 128 }),
};

type Outcome = "probed" | "INVALID_AUDIO" | "UNSUPPORTED_FORMAT";

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

const SETTLED = ["probed", "INVALID_AUDIO", "UNSUPPORTED_FORMAT"];

describe("the FLAC walkers on hostile input", () => {
  it.each(Object.entries(FIXTURES))("probe every fixture: %s", async (_, bytes) => {
    expect(await outcome(bytes)).toBe("probed");
  });

  it.each(Object.entries(FIXTURES))("settle on every truncation of %s", async (_, bytes) => {
    for (let length = 0; length < bytes.length; length += 1) {
      expect(SETTLED).toContain(await outcome(bytes.slice(0, length)));
    }
  });

  it("settle on random bytes behind a FLAC or Ogg marker", async () => {
    const marker = fc.constantFrom("fLaC", "OggS", "ID3\x04\0\0\0\0\0\x00fLaC");
    await fc.assert(
      fc.asyncProperty(marker, fc.uint8Array({ maxLength: 512 }), async (m, tail) => {
        const head = Uint8Array.from(m, (char) => char.charCodeAt(0));
        expect(SETTLED).toContain(await outcome(Uint8Array.from([...head, ...tail])));
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

  it("never accept a declared length beyond the frames", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: TONE.length + 1, max: 2 ** 36 - 1 }), async (total) => {
        expect(await outcome(flacFile([TONE], { totalFrames: total }))).toBe("INVALID_AUDIO");
        expect(await outcome(oggFlacFile([TONE], { totalFrames: total }))).toBe("INVALID_AUDIO");
      }),
      { numRuns: 100 },
    );
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: TONE.length + 1, max: 2 ** 40 }), async (granule) => {
        expect(await outcome(oggFlacFile([TONE], { lastGranule: granule }))).toBe("INVALID_AUDIO");
      }),
      { numRuns: 100 },
    );
  });
});
