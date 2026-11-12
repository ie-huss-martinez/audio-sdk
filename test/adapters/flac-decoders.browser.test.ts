import { beforeAll, describe, expect, it } from "vitest";
import { probeFile } from "../../src/adapters/probe.js";
import { flacFile, flacFrame, oggFlacFile } from "../fixtures/flac-files.js";

/**
 * Decodes, or gives up after `ms`: a decoder may never settle on a crafted
 * file, which is why the engine applies `maxProcessingTime` (sdk-core
 * ADR 0031). WebKit's did, once, on the 8 kHz case below.
 */
async function decodeWithin(
  bytes: Uint8Array<ArrayBuffer>,
  offline: OfflineAudioContext,
  ms = 5_000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  try {
    return await Promise.race([offline.decodeAudioData(bytes.slice().buffer), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const TONE = Array.from({ length: 3_000 }, (_, i) => Math.sin(i / 9) * 0.5);

/**
 * The walkers' bounds against the browsers' own decoders (docs/adr/0001):
 * what `decodeAudioData` returns for the fixtures must fit within the bound
 * plus the tolerance. This also proves the fixtures are valid FLAC.
 */
describe("FLAC bounds against the browser's decoder", () => {
  // Crafted frames: a valid CRC-8 header, a deliberately wrong CRC-16, and a
  // lower rate or more channels than STREAMINFO declares.
  const crafted = (options: { frameRateCode?: number; channels?: number; validCrc16?: boolean }) =>
    Array.from({ length: 3 }, (_, k) =>
      flacFrame(
        Array.from({ length: options.channels ?? 2 }, () => TONE),
        0,
        2_048,
        6 + k,
        {
          breakCrc16: true,
          ...(options.frameRateCode ? { frameRateCode: options.frameRateCode } : {}),
        },
      ),
    );
  const cases = {
    "native FLAC": flacFile([TONE, TONE], { sampleRate: 44_100, blockSize: 512 }),
    "FLAC in Ogg": oggFlacFile([TONE, TONE], { sampleRate: 44_100, blockSize: 512 }),
    "8 kHz frames in a 48 kHz stream": flacFile([TONE, TONE], {
      sampleRate: 48_000,
      blockSize: 512,
      appendedFrames: crafted({ frameRateCode: 4 }),
    }),
    "8-channel frames in a stereo stream": flacFile([TONE, TONE], {
      sampleRate: 48_000,
      blockSize: 512,
      appendedFrames: crafted({ channels: 8 }),
    }),
    "8 kHz frames in a 48 kHz stream, valid CRC-16": flacFile([TONE, TONE], {
      sampleRate: 48_000,
      blockSize: 512,
      appendedFrames: crafted({ frameRateCode: 4, validCrc16: true }),
    }),
    "8-channel frames in a stereo stream, valid CRC-16": flacFile([TONE, TONE], {
      sampleRate: 48_000,
      blockSize: 512,
      appendedFrames: crafted({ channels: 8, validCrc16: true }),
    }),
  };

  // Whether this browser decodes FLAC at all, so that a crafted file's
  // refusal is told apart from a missing decoder.
  let decodesFlac = false;
  beforeAll(async () => {
    const offline = new OfflineAudioContext(2, 1, 44_100);
    decodesFlac = await decodeWithin(cases["native FLAC"], offline)
      .then((result) => result !== "timeout")
      .catch(() => false);
  });

  for (const [name, bytes] of Object.entries(cases)) {
    it(`decodes ${name} within the bound`, async (context) => {
      const { probe } = await probeFile(new Blob([bytes]));
      const offline = new OfflineAudioContext(probe.channels, 1, probe.sampleRate);
      let decoded: AudioBuffer | "timeout";
      try {
        decoded = await decodeWithin(bytes, offline);
        if (decoded === "timeout") throw new Error("didn't settle");
      } catch {
        if (decodesFlac && name.includes("frames in a")) {
          // Refusing a crafted file, or never settling on it, is a safe
          // outcome: nothing was decoded.
          return;
        }
        // Not every browser decodes every container; the capability matrix
        // in the end-to-end suites records which (docs/adr/0001).
        context.skip(`${name} isn't decodable in this browser`);
        return;
      }
      expect(decoded.sampleRate).toBe(probe.sampleRate);
      // The decoded size must fit the bound, in samples, plus the tolerance.
      expect(decoded.length * decoded.numberOfChannels).toBeLessThanOrEqual(
        (probe.frameBound + probe.frameTolerance) * probe.channels,
      );
      expect(decoded.length).toBeGreaterThanOrEqual(
        Math.min(probe.expectedFrames, TONE.length) - probe.frameTolerance,
      );
      expect(decoded.getChannelData(0)[100]).toBeCloseTo(TONE[100] ?? 0, 3);
    });
  }
});
