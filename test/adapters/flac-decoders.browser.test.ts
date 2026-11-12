import { describe, expect, it } from "vitest";
import { probeFile } from "../../src/adapters/probe.js";
import { flacFile, oggFlacFile } from "../fixtures/flac-files.js";

const TONE = Array.from({ length: 3_000 }, (_, i) => Math.sin(i / 9) * 0.5);

/**
 * The walkers' bounds against the browsers' own decoders (docs/adr/0001):
 * what `decodeAudioData` returns for the fixtures must fit within the bound
 * plus the tolerance. This also proves the fixtures are valid FLAC.
 */
describe("FLAC bounds against the browser's decoder", () => {
  const cases = {
    "native FLAC": flacFile([TONE, TONE], { sampleRate: 44_100, blockSize: 512 }),
    "FLAC in Ogg": oggFlacFile([TONE, TONE], { sampleRate: 44_100, blockSize: 512 }),
  };

  for (const [name, bytes] of Object.entries(cases)) {
    it(`decodes ${name} within the bound`, async (context) => {
      const { probe } = await probeFile(new Blob([bytes]));
      const offline = new OfflineAudioContext(probe.channels, 1, probe.sampleRate);
      let decoded: AudioBuffer;
      try {
        decoded = await offline.decodeAudioData(bytes.slice().buffer);
      } catch {
        // Not every browser decodes every container; the capability matrix
        // in the end-to-end suites records which (docs/adr/0001).
        context.skip(`${name} isn't decodable in this browser`);
        return;
      }
      expect(decoded.sampleRate).toBe(probe.sampleRate);
      expect(decoded.numberOfChannels).toBe(probe.channels);
      expect(decoded.length).toBeLessThanOrEqual(probe.frameBound + probe.frameTolerance);
      expect(decoded.length).toBeGreaterThanOrEqual(probe.expectedFrames - probe.frameTolerance);
      expect(decoded.getChannelData(0)[100]).toBeCloseTo(TONE[100] ?? 0, 3);
    });
  }
});
