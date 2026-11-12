import { describe, expect, it } from "vitest";
import { createAudioEngine, isAudioError } from "../../src/index.js";
import { adtsFile, mp3File, mp3Frame } from "../fixtures/mpeg-files.js";

/**
 * The MP3 and ADTS bounds against the browsers' own decoders, through the
 * real engine, whose page-side decode checks the output against the bound
 * (docs/adr/0001, sdk-core ADR 0031).
 */
describe("MP3 and ADTS against the browser's decoder", () => {
  const honest = {
    "MP3 at 44.1 kHz": mp3File({ frames: 60 }),
    "MP3 with an Info tag and LAME delay": mp3File({
      frames: 60,
      info: { frames: 60, delay: 576, padding: 1_000 },
    }),
    "ADTS AAC at 44.1 kHz": adtsFile(60, { sampleRate: 44_100 }),
    "ADTS AAC at 22.05 kHz, possibly HE-AAC": adtsFile(60, { sampleRate: 22_050 }),
  };

  for (const [name, bytes] of Object.entries(honest)) {
    it(`decodes ${name} within the bound`, async (context) => {
      const engine = createAudioEngine();
      const file = new Blob([bytes]);
      const probe = await engine.probe(file);
      let audio: Awaited<ReturnType<typeof engine.decode>>;
      try {
        audio = await engine.decode(file, probe, { signal: AbortSignal.timeout(10_000) });
      } catch (error) {
        if (isAudioError(error, "DECODE_FAILED"))
          context.skip(`${name} isn't decodable in this browser`);
        throw error;
      }
      await context.annotate(
        `decoded ${audio.length} × ${audio.numberOfChannels} at ${audio.sampleRate} Hz; bound ${probe.frameBound}, expected ${probe.expectedFrames}, tolerance ${probe.frameTolerance}`,
      );
      // decodeOnPage has already refused anything past the bound.
      expect(audio.sampleRate).toBe(probe.sampleRate);
      expect(audio.length).toBeLessThanOrEqual(probe.frameBound);
      expect(audio.length).toBeGreaterThanOrEqual(probe.expectedFrames - probe.frameTolerance);
      expect(Math.max(...audio.getChannelData(0).map(Math.abs))).toBeLessThan(0.01);
      await engine.destroy();
    });
  }

  it("settles on crafted MP3 frames at a lower rate within the bound or with a code", async (context) => {
    // MPEG-2.5 frames at 8 kHz after a 48 kHz stream.
    const slow = mp3Frame({ version: 2.5, sampleRate: 8_000, bitrateIndex: 8 });
    const file = new Blob([
      mp3File({ frames: 30, sampleRate: 48_000, appended: [slow, slow, slow] }),
    ]);
    const engine = createAudioEngine();
    const probe = await engine.probe(file);
    expect(probe.frameBound).toBe(30 * 1_152 + 3 * 576 * 6);
    try {
      const audio = await engine.decode(file, probe, { signal: AbortSignal.timeout(5_000) });
      await context.annotate(`decoded ${audio.length} frames; bound ${probe.frameBound}`);
      expect(audio.length).toBeLessThanOrEqual(probe.frameBound);
    } catch (error) {
      await context.annotate(`refused: ${(error as { code?: string }).code}`);
      const allowed = ["DECODE_FAILED", "INVALID_AUDIO", "TIMEOUT"] as const;
      expect(
        allowed.some((code) => isAudioError(error, code)),
        String(error),
      ).toBe(true);
    }
    await engine.destroy();
  });
});
