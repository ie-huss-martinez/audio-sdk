import { describe, expect, it } from "vitest";
import { mp4File } from "../../../test/fixtures/mp4-files.js";
import { isAudioError } from "../../core/errors/audio-error.js";
import { probeFile } from "../probe.js";

const blob = (bytes: Uint8Array<ArrayBuffer>) => new Blob([bytes]);

async function failure(
  promise: Promise<unknown>,
): Promise<{ code: string | undefined; reason: unknown }> {
  try {
    await promise;
  } catch (error) {
    return {
      code: (error as { code?: string }).code,
      reason: (error as { details?: { reason?: unknown } }).details?.reason,
    };
  }
  throw new Error("expected a failure");
}

describe("MP4 with AAC", () => {
  it("bounds the track by its samples, 1,024 frames each above 24 kHz", async () => {
    const { probe } = await probeFile(blob(mp4File({ samples: 23 })));
    expect(probe).toEqual({
      container: "mp4",
      codec: "aac",
      sampleRate: 44_100,
      channels: 2,
      frameBound: 23 * 1_024,
      expectedFrames: 23 * 1_024,
      frameTolerance: 2 * 1_024,
    });
  });

  it("counts every sample as possibly HE-AAC at 24 kHz or less", async () => {
    const { probe } = await probeFile(blob(mp4File({ samples: 10, sampleRate: 22_050 })));
    expect(probe).toMatchObject({
      sampleRate: 44_100,
      frameBound: 10 * 2_048,
      expectedFrames: 10 * 2_048,
    });
  });

  it("allows for parametric stereo in mono, and eight channels when the config doesn't say", async () => {
    const mono = await probeFile(blob(mp4File({ samples: 4, channelConfiguration: 1 })));
    expect(mono.probe.channels).toBe(2);
    const pce = await probeFile(blob(mp4File({ samples: 4, channelConfiguration: 7 })));
    expect(pce.probe.channels).toBe(8);
  });

  it("refuses a duration that claims more than the samples carry", async () => {
    expect(await failure(probeFile(blob(mp4File({ samples: 10, duration: 1_000_000 }))))).toEqual({
      code: "INVALID_AUDIO",
      reason: "the duration claims more than the samples carry",
    });
  });

  it("refuses a sample outside the file, and tables that disagree", async () => {
    expect(
      await failure(probeFile(blob(mp4File({ samples: 12, chunkOutsideFile: true })))),
    ).toEqual({
      code: "INVALID_AUDIO",
      reason: "a sample lies outside the file",
    });
    expect(await failure(probeFile(blob(mp4File({ samples: 12, stszCount: 4_000_000 }))))).toEqual({
      code: "INVALID_AUDIO",
      reason: "the sample tables disagree",
    });
    expect(await failure(probeFile(blob(mp4File({ samples: 12, stszCount: 3 }))))).toEqual({
      code: "INVALID_AUDIO",
      reason: "the sample tables disagree",
    });
  });

  it("refuses fragmented files and several audio tracks", async () => {
    expect(await failure(probeFile(blob(mp4File({ samples: 4, fragmented: true }))))).toMatchObject(
      {
        code: "UNSUPPORTED_FORMAT",
        reason: "fragmented MP4",
      },
    );
    expect(
      await failure(probeFile(blob(mp4File({ samples: 4, secondAudioTrack: true })))),
    ).toMatchObject({
      code: "UNSUPPORTED_FORMAT",
      reason: "several audio tracks",
    });
  });
});

describe("MP4 edit lists", () => {
  const SAMPLES = 20;
  const MEDIA = SAMPLES * 1_024;

  it("accepts what encoders write: a short empty edit, then one media edit within the media", async () => {
    for (const version of [0, 1] as const) {
      const { probe } = await probeFile(
        blob(
          mp4File({
            samples: SAMPLES,
            editList: {
              version,
              entries: [
                { duration: 1_000, mediaTime: -1 },
                { duration: MEDIA - 2_112, mediaTime: 2_112 },
              ],
            },
          }),
        ),
      );
      expect(probe.frameBound).toBe(MEDIA);
    }
  });

  it.each([
    [
      "the media played three times",
      [
        { duration: MEDIA, mediaTime: 0 },
        { duration: MEDIA, mediaTime: 0 },
        { duration: MEDIA, mediaTime: 0 },
      ],
      "edit list with more than two edits",
    ],
    [
      "two media edits",
      [
        { duration: MEDIA, mediaTime: 0 },
        { duration: MEDIA, mediaTime: 0 },
      ],
      "edit list with several media edits",
    ],
    [
      "a long empty edit",
      [
        { duration: 44_100 * 60, mediaTime: -1 },
        { duration: MEDIA, mediaTime: 0 },
      ],
      "edit list with a long empty edit",
    ],
    [
      "an empty edit after a media edit",
      [
        { duration: MEDIA, mediaTime: 0 },
        { duration: 100, mediaTime: -1 },
      ],
      "edit list with an empty edit after another edit",
    ],
    [
      "a media rate of 2",
      [{ duration: MEDIA, mediaTime: 0, rate: 2 }],
      "edit list with a media rate other than 1",
    ],
    [
      "a media edit beyond the media",
      [{ duration: MEDIA, mediaTime: 5_000 }],
      "edit list beyond the media",
    ],
  ])("refuses %s", async (_, entries, reason) => {
    expect(
      await failure(probeFile(blob(mp4File({ samples: SAMPLES, editList: { entries } })))),
    ).toEqual({
      code: "UNSUPPORTED_FORMAT",
      reason,
    });
  });
});

describe("MP4 with ALAC", () => {
  it("bounds the track by its samples and the configured frame length", async () => {
    const { probe } = await probeFile(
      blob(mp4File({ codec: "alac", samples: 6, alacFrameLength: 4_096, sampleRate: 48_000 })),
    );
    expect(probe).toEqual({
      container: "mp4",
      codec: "alac",
      sampleRate: 48_000,
      channels: 2,
      frameBound: 6 * 4_096,
      expectedFrames: 6 * 4_096,
      frameTolerance: 2 * 4_096,
    });
  });

  it("refuses a frame length of zero", async () => {
    const error = await failure(
      probeFile(blob(mp4File({ codec: "alac", samples: 2, alacFrameLength: 0 }))),
    );
    expect(error.code).toBe("INVALID_AUDIO");
  });
});

describe("MP4 boxes", () => {
  it("refuses a box that exceeds its parent", async () => {
    const bytes = mp4File({ samples: 4 });
    // ftyp is 24 bytes; make moov claim more than the file.
    new DataView(bytes.buffer).setUint32(24, 0x7fffffff);
    const error = await failure(probeFile(blob(bytes)));
    expect(error).toEqual({ code: "INVALID_AUDIO", reason: "box exceeds its parent" });
    expect(isAudioError(new Error())).toBe(false);
  });
});
