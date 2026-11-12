import { describe, expect, it } from "vitest";
import { createAudioEngine, isAudioError } from "../../src/index.js";
import { webmFile } from "../fixtures/webm-files.js";

/**
 * The WebM bound against the browsers' own decoders, through the real
 * engine, whose page-side decode checks the output against the bound
 * (docs/adr/0001, sdk-core ADR 0031).
 */
describe("WebM Opus against the browser's decoder", () => {
  const files = {
    "WebM Opus with sizes and a Duration": webmFile({ packets: 100, durationMs: 2_000 }),
    "WebM Opus as MediaRecorder writes it": webmFile({
      packets: 100,
      unknownSizes: true,
      blocksPerCluster: 25,
    }),
    "Xiph-laced WebM Opus with a video track": webmFile({
      packets: 100,
      lacing: "xiph",
      framesPerBlock: 5,
      videoTrack: true,
    }),
    "EBML-laced WebM Opus": webmFile({ packets: 100, lacing: "ebml", framesPerBlock: 4 }),
    "crafted 120 ms packets with no frame data": webmFile({
      packets: 0,
      customPackets: Array.from({ length: 20 }, () => [(31 << 3) | 3, 6]),
    }),
  };

  for (const [name, bytes] of Object.entries(files)) {
    it(`decodes ${name} within the bound, or refuses it`, async (context) => {
      const engine = createAudioEngine();
      const file = new Blob([bytes]);
      const probe = await engine.probe(file);
      try {
        const audio = await engine.decode(file, probe, { signal: AbortSignal.timeout(10_000) });
        await context.annotate(
          `decoded ${audio.length} × ${audio.numberOfChannels} at ${audio.sampleRate} Hz; bound ${probe.frameBound}, expected ${probe.expectedFrames}`,
        );
        expect(audio.sampleRate).toBe(48_000);
        expect(audio.length).toBeLessThanOrEqual(probe.frameBound);
        if (!name.startsWith("crafted")) {
          expect(audio.length).toBeGreaterThanOrEqual(probe.expectedFrames - probe.frameTolerance);
        }
      } catch (error) {
        await context.annotate(`refused: ${(error as { code?: string }).code}`);
        if (!name.startsWith("crafted") && isAudioError(error, "DECODE_FAILED")) {
          context.skip(`${name} isn't decodable in this browser`);
        }
        const allowed = ["DECODE_FAILED", "INVALID_AUDIO"] as const;
        expect(
          allowed.some((code) => isAudioError(error, code)),
          String(error),
        ).toBe(true);
      }
      await engine.destroy();
    });
  }
});
