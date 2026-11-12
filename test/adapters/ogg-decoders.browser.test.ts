import { describe, expect, it } from "vitest";
import { createAudioEngine, isAudioError } from "../../src/index.js";
import { oggOpusFile } from "../fixtures/ogg-files.js";

/**
 * The Opus bound against the browsers' own decoders, through the real
 * engine, whose page-side decode checks the output against the bound
 * (docs/adr/0001, sdk-core ADR 0031). Vorbis fixtures can't be decoded,
 * because a decodable stream needs real codebooks; they exercise the probe.
 */
describe("Opus in Ogg against the browser's decoder", () => {
  const files = {
    "silent stereo Opus with a 312-sample pre-skip": oggOpusFile({ packets: 100 }),
    "silent mono Opus": oggOpusFile({ packets: 50, channels: 1, preSkip: 0 }),
    // Crafted: code-3 packets claiming six 20 ms frames each (the 120 ms
    // maximum) with no frame data behind them.
    "crafted 120 ms packets with no frame data": oggOpusFile({
      packets: 0,
      lastGranule: 0,
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
