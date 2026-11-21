import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { webmFile } from "../../../test/fixtures/webm-files.js";
import { isAudioError } from "../../core/errors/audio-error.js";
import { probeFile } from "../probe.js";

/**
 * The Matroska walker are hostile-input code (docs/adr/0001): on any
 * bytes, they must settle quickly with a probe whose expected length is
 * within its bound, or with `INVALID_AUDIO` or `UNSUPPORTED_FORMAT`, and
 * never hang or throw anything else.
 */

const SETTLE_MS = 1_000;

const FIXTURES: Record<string, Uint8Array<ArrayBuffer>> = {
  "WebM Opus with sizes and a Duration": webmFile({
    packets: 15,
    durationMs: 300,
    blocksPerCluster: 5,
  }),
  "WebM Opus as MediaRecorder writes it": webmFile({
    packets: 15,
    unknownSizes: true,
    blocksPerCluster: 4,
  }),
  "WebM Opus, EBML-laced, with video": webmFile({
    packets: 12,
    lacing: "ebml",
    framesPerBlock: 3,
    videoTrack: true,
  }),
  "WebM Opus, Xiph-laced": webmFile({ packets: 10, lacing: "xiph", framesPerBlock: 5 }),
  "WebM Vorbis": webmFile({ codec: "vorbis", packets: 8 }),
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

describe("the Matroska walker on hostile input", () => {
  it.each(Object.entries(FIXTURES))("probe every fixture: %s", async (_, bytes) => {
    expect(await outcome(bytes)).toBe("probed");
  });

  it.each(Object.entries(FIXTURES))("settle on every truncation of %s", async (_, bytes) => {
    for (let length = 0; length < bytes.length; length += 1) {
      expect(SETTLED).toContain(await outcome(bytes.slice(0, length)));
    }
  });

  it("settle on random bytes after a valid EBML header and Segment", async () => {
    const prefix = webmFile({ packets: 1 }).slice(0, 40);
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 512 }), async (tail) => {
        expect(SETTLED).toContain(await outcome(Uint8Array.from([...prefix, ...tail])));
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

  it("never accept a Duration beyond the blocks", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 15 * 20 + 1, max: 10 ** 9 }), async (durationMs) => {
        expect(await outcome(webmFile({ packets: 15, durationMs }))).toBe("INVALID_AUDIO");
      }),
      { numRuns: 100 },
    );
  });
});
