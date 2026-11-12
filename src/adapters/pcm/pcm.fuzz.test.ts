import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { aiffFile, wavFile } from "../../../test/fixtures/pcm-files.js";
import { isAudioError } from "../../core/errors/audio-error.js";
import { probePcm, readPcmFrames } from "./probe.js";

/**
 * The readers are hostile-input code (docs/adr/0001): on any bytes at all,
 * they must settle quickly with a layout that can be read in full, or with
 * `INVALID_AUDIO` or `UNSUPPORTED_FORMAT`, and never hang or throw anything
 * else.
 */

const SETTLE_MS = 1_000;
const TONE = Array.from({ length: 64 }, (_, i) => Math.sin(i / 3) * 0.8);

const FIXTURES: Record<string, Uint8Array<ArrayBuffer>> = {
  "16-bit WAV": wavFile([TONE, TONE]),
  "24-bit extensible WAV": wavFile([TONE], { format: "pcm24", extensible: true }),
  "float RF64": wavFile([TONE], { format: "float32", rf64: true }),
  "WAV with an odd chunk": wavFile([TONE], { oddChunk: true, format: "pcm8" }),
  "16-bit AIFF": aiffFile([TONE, TONE]),
  "AIFC sowt": aiffFile([TONE], { type: "sowt" }),
  "AIFC fl64": aiffFile([TONE], { type: "fl64" }),
};

type Outcome = "read" | "INVALID_AUDIO" | "UNSUPPORTED_FORMAT";

/** Probes and reads every frame; the outcome, or a test failure for anything unexpected. */
async function outcome(bytes: Uint8Array<ArrayBuffer>): Promise<Outcome> {
  const file = new Blob([bytes]);
  const attempt = (async (): Promise<Outcome> => {
    try {
      const { layout } = await probePcm(file);
      const channels = await readPcmFrames(file, layout, 0, layout.frames);
      expect(channels).toHaveLength(layout.channels);
      for (const channel of channels) {
        expect(channel).toHaveLength(layout.frames);
        // Integer samples are within full scale by construction; float files
        // may hold values beyond it, but never non-finite ones.
        const limit = layout.encoding === "float" ? Number.POSITIVE_INFINITY : 1;
        expect(
          channel.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= limit),
        ).toBe(true);
      }
      return "read";
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

describe("the PCM readers on hostile input", () => {
  it.each(Object.entries(FIXTURES))("read every fixture in full: %s", async (_, bytes) => {
    expect(await outcome(bytes)).toBe("read");
  });

  it.each(Object.entries(FIXTURES))(
    "settle on every truncation of %s, never reading past the end",
    async (_, bytes) => {
      for (let length = 0; length < bytes.length; length += 1) {
        const result = await outcome(bytes.slice(0, length));
        // A truncated file can still be valid, if only trailing padding or
        // whole frames are missing and the header doesn't claim them.
        expect(["read", "INVALID_AUDIO", "UNSUPPORTED_FORMAT"]).toContain(result);
      }
    },
  );

  it("settle on random bytes", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 512 }), async (bytes) => {
        expect(["read", "INVALID_AUDIO", "UNSUPPORTED_FORMAT"]).toContain(await outcome(bytes));
      }),
      { numRuns: 300 },
    );
  });

  it("settle on random bytes behind a valid magic number", async () => {
    const magic = fc.constantFrom("RIFF", "RF64", "FORM");
    const form = fc.constantFrom("WAVE", "AIFF", "AIFC");
    await fc.assert(
      fc.asyncProperty(magic, form, fc.uint8Array({ maxLength: 512 }), async (m, f, tail) => {
        const head = new TextEncoder().encode(`${m}\0\0\0\0${f}`);
        expect(["read", "INVALID_AUDIO", "UNSUPPORTED_FORMAT"]).toContain(
          await outcome(Uint8Array.from([...head, ...tail])),
        );
      }),
      { numRuns: 300 },
    );
  });

  it("settle on fixtures with corrupted bytes", async () => {
    const fixture = fc.constantFrom(...Object.values(FIXTURES));
    const edits = fc.array(fc.tuple(fc.nat(), fc.integer({ min: 0, max: 255 })), {
      minLength: 1,
      maxLength: 8,
    });
    await fc.assert(
      fc.asyncProperty(fixture, edits, async (original, changes) => {
        const bytes = original.slice();
        // Most edits land in the header, where the readers make decisions.
        for (const [position, value] of changes)
          bytes[position % Math.min(bytes.length, 96)] = value;
        expect(["read", "INVALID_AUDIO", "UNSUPPORTED_FORMAT"]).toContain(await outcome(bytes));
      }),
      { numRuns: 500 },
    );
  });

  it("never read past the file, whatever length a header declares", async () => {
    // A header may claim more than the file holds, as a truncated file's
    // does: the file opens with exactly the frames it holds.
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: TONE.length * 4 + 1, max: 0xfffffffe }), async (size) => {
        const { probe } = await probePcm(new Blob([wavFile([TONE, TONE], { dataSize: size })]));
        expect(probe.frameBound).toBe(TONE.length);
        expect(probe.declaredFrames).toBe(Math.floor(size / 4));
      }),
      { numRuns: 100 },
    );
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: TONE.length + 1, max: 0xffffffff }), async (frames) => {
        const { probe } = await probePcm(new Blob([aiffFile([TONE], { frames })]));
        expect(probe.frameBound).toBe(TONE.length);
        expect(probe.declaredFrames).toBe(frames);
      }),
      { numRuns: 100 },
    );
  });
});
