import { describe, expect, it } from "vitest";
import { audioLimits, createAudioEngine, isAudioError } from "../../src/index.js";
import { flacFile, flacFrame, oggFlacFile } from "../fixtures/flac-files.js";

const TONE = Array.from({ length: 3_000 }, (_, i) => Math.sin(i / 9) * 0.5);
const STEP = 1 / 32_768;

/** Whether this browser's own decoder handles FLAC at all. */
async function decodesFlac(): Promise<boolean> {
  const bytes = flacFile([TONE], { sampleRate: 44_100 });
  const offline = new OfflineAudioContext(1, 1, 44_100);
  const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000));
  return Promise.race([
    offline.decodeAudioData(bytes.slice().buffer).then(
      () => true,
      () => false,
    ),
    timeout,
  ]);
}

/** The file policy's own time-limit error, as the session will pass it. */
function timeLimit(): unknown {
  try {
    audioLimits.resolve({ maxProcessingTime: 1 }).check("maxProcessingTime", 2);
  } catch (error) {
    return error;
  }
  throw new Error("expected the limit to be exceeded");
}

describe("the engine decodes compressed files on the page (sdk-core ADR 0031)", () => {
  for (const [name, bytes] of Object.entries({
    "native FLAC": flacFile([TONE, TONE], { sampleRate: 44_100, blockSize: 512 }),
    "FLAC in Ogg": oggFlacFile([TONE, TONE], { sampleRate: 44_100, blockSize: 512 }),
  })) {
    it(`decodes ${name} sample for sample, at its own rate`, async (context) => {
      if (!(await decodesFlac())) context.skip("this browser has no FLAC decoder");
      const engine = createAudioEngine();
      const file = new Blob([bytes]);
      const audio = await engine.decode(file, await engine.probe(file));
      expect(audio).toMatchObject({ sampleRate: 44_100, numberOfChannels: 2, length: 3_000 });
      const left = audio.getChannelData(0);
      for (let i = 0; i < TONE.length; i += 97) {
        expect(Math.abs((left[i] ?? 0) - (TONE[i] ?? 0))).toBeLessThanOrEqual(STEP);
      }
      expect(await engine.peaks(audio)).toHaveProperty("levels");
      await engine.destroy();
    });
  }

  it("settles in time on a crafted file a decoder once hung on, whatever the browser does", async () => {
    // Crafted frames that declare 8 kHz in a 48 kHz stream, with a wrong
    // CRC-16: WebKit's decodeAudioData once never settled on this file.
    const crafted = Array.from({ length: 3 }, (_, k) =>
      flacFrame([TONE, TONE], 0, 2_048, 6 + k, { frameRateCode: 4, breakCrc16: true }),
    );
    const file = new Blob([
      flacFile([TONE, TONE], { sampleRate: 48_000, blockSize: 512, appendedFrames: crafted }),
    ]);
    const engine = createAudioEngine();
    const probe = await engine.probe(file);
    const controller = new AbortController();
    const limit = 3_000;
    const timer = setTimeout(() => controller.abort(timeLimit()), limit);
    const started = performance.now();
    try {
      const audio = await engine.decode(file, probe, { signal: controller.signal });
      // Decoded: then it must fit the bound.
      expect(audio.length).toBeLessThanOrEqual(probe.frameBound + probe.frameTolerance);
    } catch (error) {
      const allowed = ["DECODE_FAILED", "INVALID_AUDIO", "PROCESSING_TIME_EXCEEDED"] as const;
      expect(
        allowed.some((code) => isAudioError(error, code)),
        String(error),
      ).toBe(true);
    } finally {
      clearTimeout(timer);
    }
    // It never waits past the limit, whatever the decoder does.
    expect(performance.now() - started).toBeLessThan(limit + 1_000);
    await engine.destroy();
  });
});
