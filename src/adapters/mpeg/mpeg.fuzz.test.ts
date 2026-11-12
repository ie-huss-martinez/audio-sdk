import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { adtsFile, mp3File } from "../../../test/fixtures/mpeg-files.js";
import { isAudioError } from "../../core/errors/audio-error.js";
import { probeFile } from "../probe.js";

/**
 * The MP3 and ADTS walkers are hostile-input code (docs/adr/0001): on any bytes, they
 * must settle quickly with a probe whose expected length is within its
 * bound, or with `INVALID_AUDIO` or `UNSUPPORTED_FORMAT`, and never hang or
 * throw anything else.
 */

const SETTLE_MS = 1_000;
const FIXTURES: Record<string, Uint8Array<ArrayBuffer>> = {
  "MP3, stereo": mp3File({ frames: 6 }),
  "MP3 after ID3v2, with an Info tag": mp3File({
    frames: 5,
    id3: true,
    info: { frames: 5, delay: 576, padding: 300 },
  }),
  "MP3, MPEG-2.5 mono, with a VBRI tag": mp3File({
    frames: 6,
    version: 2.5,
    sampleRate: 8_000,
    mono: true,
    bitrateIndex: 8,
    vbri: { frames: 6, delay: 100 },
  }),
  "ADTS at 48 kHz": adtsFile(8, { sampleRate: 48_000 }),
  "ADTS at 22.05 kHz, mono": adtsFile(8, { sampleRate: 22_050, channelConfiguration: 1 }),
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

describe("the MP3 and ADTS walkers on hostile input", () => {
  it.each(Object.entries(FIXTURES))("probe every fixture: %s", async (_, bytes) => {
    expect(await outcome(bytes)).toBe("probed");
  });

  it.each(Object.entries(FIXTURES))("settle on every truncation of %s", async (_, bytes) => {
    for (let length = 0; length < bytes.length; length += 1) {
      expect(SETTLED).toContain(await outcome(bytes.slice(0, length)));
    }
  });

  it("settle on random bytes behind an MP3, ADTS or ID3 start", async () => {
    const marker = fc.constantFrom(
      "\xff\xfb\x90\x00",
      "\xff\xf1\x50\x80",
      "ID3\x04\0\0\0\0\0\x00\xff\xfb",
    );
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

  it("never accept a tag that claims more than the frames carry", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 7, max: 0xffffffff }), async (claimed) => {
        expect(await outcome(mp3File({ frames: 5, info: { frames: claimed } }))).toBe(
          "INVALID_AUDIO",
        );
      }),
      { numRuns: 100 },
    );
  });
});
