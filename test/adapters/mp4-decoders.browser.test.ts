import { describe, expect, it } from "vitest";
import { createAudioEngine, isAudioError } from "../../src/index.js";
import { mp4File } from "../fixtures/mp4-files.js";

/**
 * The MP4 bound against the browsers' own decoders, through the real engine,
 * whose page-side decode checks the output against the bound
 * (docs/adr/0001, sdk-core ADR 0031).
 */
describe("MP4 AAC against the browser's decoder", () => {
  const files = {
    "AAC at 44.1 kHz": mp4File({ samples: 60 }),
    "AAC at 22.05 kHz, possibly HE-AAC": mp4File({ samples: 60, sampleRate: 22_050 }),
    "AAC at 48 kHz, one sample per chunk": mp4File({
      samples: 40,
      sampleRate: 48_000,
      samplesPerChunk: 1,
    }),
  };

  for (const [name, bytes] of Object.entries(files)) {
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
      expect(audio.sampleRate).toBe(probe.sampleRate);
      expect(audio.length).toBeLessThanOrEqual(probe.frameBound);
      expect(audio.length).toBeGreaterThanOrEqual(probe.expectedFrames - probe.frameTolerance);
      expect(Math.max(...audio.getChannelData(0).map(Math.abs))).toBeLessThan(0.01);
      await engine.destroy();
    });
  }
});
