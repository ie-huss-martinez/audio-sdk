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

  // Crafted edit lists the probe refuses. Decoded here without the engine,
  // to record what each browser would do with them.
  const SAMPLES = 40;
  const MEDIA = SAMPLES * 1_024;
  const crafted = {
    "an edit list that plays the media three times": mp4File({
      samples: SAMPLES,
      editList: {
        entries: [
          { duration: MEDIA, mediaTime: 0 },
          { duration: MEDIA, mediaTime: 0 },
          { duration: MEDIA, mediaTime: 0 },
        ],
      },
    }),
    "an edit list with a minute-long empty edit": mp4File({
      samples: SAMPLES,
      editList: {
        entries: [
          { duration: 44_100 * 60, mediaTime: -1 },
          { duration: MEDIA, mediaTime: 0 },
        ],
      },
    }),
  };

  for (const [name, bytes] of Object.entries(crafted)) {
    it(`refuses ${name}, recording what the browser alone does`, async (context) => {
      const engine = createAudioEngine();
      const error = await engine.probe(new Blob([bytes])).then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(isAudioError(error, "UNSUPPORTED_FORMAT"), String(error)).toBe(true);
      await engine.destroy();

      const offline = new OfflineAudioContext(2, 1, 44_100);
      const timeout = new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), 5_000),
      );
      const decoded = await Promise.race([
        offline.decodeAudioData(bytes.slice().buffer).then(
          (audio) => `${audio.length} frames`,
          () => "refused",
        ),
        timeout,
      ]);
      await context.annotate(`the browser alone: ${decoded}; the samples carry ${MEDIA} frames`);
    });
  }
});
