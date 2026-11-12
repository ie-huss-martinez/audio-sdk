import { describe, expect, it } from "vitest";
import { adtsFile, adtsFrame, mp3File, mp3Frame } from "../../../test/fixtures/mpeg-files.js";
import { isAudioError } from "../../core/errors/audio-error.js";
import { readAdtsHeader } from "../aac/adts.js";
import { probeFile } from "../probe.js";
import { readMpegHeader } from "./mpeg-audio.js";

const blob = (bytes: Uint8Array<ArrayBuffer>) => new Blob([bytes]);

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a failure");
}

describe("MPEG audio frame headers", () => {
  it("reads layer III headers of every version", () => {
    expect(readMpegHeader(Uint8Array.from(mp3Frame()), 0)).toEqual({
      version: 1,
      layer: 3,
      sampleRate: 44_100,
      channels: 2,
      samplesPerFrame: 1_152,
      frameLength: 417,
      protected: false,
    });
    const v25 = readMpegHeader(
      Uint8Array.from(mp3Frame({ version: 2.5, sampleRate: 8_000, mono: true })),
      0,
    );
    expect(v25).toMatchObject({
      version: 2.5,
      sampleRate: 8_000,
      channels: 1,
      samplesPerFrame: 576,
    });
  });

  it("refuses reserved fields and free format", () => {
    const frame = Uint8Array.from(mp3Frame());
    for (const [index, value] of [
      [1, 0xe8 | 0x3], // reserved version
      [1, 0xf9], // reserved layer
      [2, 0x00 | ((frame[2] as number) & 0x0f)], // free format
      [2, 0xf0], // bitrate 15
      [2, 0x9c], // reserved rate
      [3, 0x02], // reserved emphasis
    ] as const) {
      const bad = frame.slice();
      bad[index] = value;
      expect(readMpegHeader(bad, 0), `byte ${index} = ${value}`).toBeUndefined();
    }
  });
});

describe("MP3", () => {
  it("bounds a stream by its frames", async () => {
    const { probe } = await probeFile(blob(mp3File({ frames: 40 })));
    expect(probe).toEqual({
      container: "mp3",
      codec: "mp3",
      sampleRate: 44_100,
      channels: 2,
      frameBound: 40 * 1_152,
      expectedFrames: 40 * 1_152,
      frameTolerance: 2 * 1_152,
    });
  });

  it("uses an Info tag's count within the bound, less LAME's delay and padding, which join the tolerance", async () => {
    const file = mp3File({ frames: 40, info: { frames: 40, delay: 576, padding: 1_000 } });
    const { probe } = await probeFile(blob(file));
    // The tag's own frame counts towards the bound too.
    expect(probe).toMatchObject({
      frameBound: 41 * 1_152,
      expectedFrames: 40 * 1_152 - 576 - 1_000,
      frameTolerance: 2 * 1_152 + 576 + 1_000,
    });
  });

  it("uses a VBRI tag's count, and finds the stream after an ID3v2 tag", async () => {
    const { probe } = await probeFile(
      blob(mp3File({ frames: 20, id3: true, vbri: { frames: 20, delay: 576 } })),
    );
    expect(probe).toMatchObject({ frameBound: 21 * 1_152, expectedFrames: 20 * 1_152 - 576 });
  });

  it("refuses a tag that claims more than the frames carry", async () => {
    const error = await failure(
      probeFile(blob(mp3File({ frames: 10, info: { frames: 100_000 } }))),
    );
    expect(isAudioError(error, "INVALID_AUDIO")).toBe(true);
    expect((error as { details?: { reason?: unknown } }).details?.reason).toBe(
      "the tag claims more than the frames carry",
    );
  });

  it("counts frames at a lower rate at their resampled worst case, and wider frames by their channels", async () => {
    // MPEG-2.5 at 8 kHz in a 48 kHz stream: 576 samples, resampled ×6.
    const slow = mp3Frame({ version: 2.5, sampleRate: 8_000, bitrateIndex: 8 });
    const lower = await probeFile(
      blob(mp3File({ frames: 10, sampleRate: 48_000, appended: [slow, slow] })),
    );
    expect(lower.probe.frameBound).toBe(10 * 1_152 + 2 * 576 * 6);
    // Stereo frames in a mono stream count twice.
    const stereo = mp3Frame();
    const wider = await probeFile(blob(mp3File({ frames: 10, mono: true, appended: [stereo] })));
    expect(wider.probe).toMatchObject({ channels: 1, frameBound: 11 * 1_152 + 1_152 });
  });
});

describe("ADTS", () => {
  it("reads a header", () => {
    expect(readAdtsHeader(Uint8Array.from(adtsFrame({ sampleRate: 48_000 })), 0)).toEqual({
      sampleRate: 48_000,
      channelConfiguration: 2,
      blocks: 1,
      frameLength: 16,
    });
  });

  it("decodes at the core rate above 24 kHz, counting 1,024 frames per block", async () => {
    const { probe } = await probeFile(blob(adtsFile(30, { sampleRate: 48_000 })));
    expect(probe).toEqual({
      container: "adts",
      codec: "aac",
      sampleRate: 48_000,
      channels: 2,
      frameBound: 30 * 1_024,
      expectedFrames: 30 * 1_024,
      frameTolerance: 2 * 1_024,
    });
  });

  it("counts every block as possibly HE-AAC: twice the rate and 2,048 frames at 24 kHz or less", async () => {
    const { probe } = await probeFile(blob(adtsFile(30, { sampleRate: 22_050 })));
    expect(probe).toMatchObject({
      sampleRate: 44_100,
      frameBound: 30 * 2_048,
      frameTolerance: 2 * 2_048,
    });
  });

  it("allows for parametric stereo in mono, and eight channels when the header doesn't say", async () => {
    const mono = await probeFile(blob(adtsFile(5, { channelConfiguration: 1 })));
    expect(mono.probe.channels).toBe(2);
    const unspecified = await probeFile(blob(adtsFile(5, { channelConfiguration: 0 })));
    expect(unspecified.probe.channels).toBe(8);
  });

  it("counts a frame at a lower core rate at its resampled worst case", async () => {
    const slow = adtsFrame({ sampleRate: 8_000 });
    const { probe } = await probeFile(blob(adtsFile(10, { sampleRate: 48_000, appended: [slow] })));
    expect(probe.frameBound).toBe(10 * 1_024 + 1_024 * 6);
  });
});

describe("the dispatcher", () => {
  it("refuses bytes with no run of consistent frames", async () => {
    const lonely = Uint8Array.from([...mp3Frame().slice(0, 4), ...new Array(100).fill(7)]);
    const error = await failure(probeFile(blob(lonely)));
    expect(isAudioError(error, "UNSUPPORTED_FORMAT")).toBe(true);
  });
});
