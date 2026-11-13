import { createMessages } from "@hussmartinez/sdk-core";
import { describe, expect, it } from "vitest";
import { AudioError, type AudioErrorCode } from "../core/errors/audio-error.js";
import { audioLimitDefinitions, audioLimits } from "../core/errors/audio-limits.js";
import { audioMessages } from "./en.js";

// Listing every code here makes the type checker fail when a code is added
// to AudioErrorCode without being listed, and the test fail when its text is
// missing from the catalogue.
const ALL_CODES: Record<AudioErrorCode, true> = {
  UNKNOWN: true,
  ABORTED: true,
  TIMEOUT: true,
  WORKER_START_FAILED: true,
  WORKER_PROTOCOL_MISMATCH: true,
  WORKER_CRASHED: true,
  WORKER_TERMINATED: true,
  WORKER_METHOD_NOT_FOUND: true,
  WORKER_DATA_NOT_CLONEABLE: true,
  UNSUPPORTED_ENVIRONMENT: true,
  FILE_TOO_LARGE: true,
  TOO_MANY_FILES: true,
  DECODED_SIZE_TOO_LARGE: true,
  PROCESSING_TIME_EXCEEDED: true,
  INVALID_AUDIO: true,
  UNSUPPORTED_FORMAT: true,
  DECODE_FAILED: true,
  INVALID_COMMAND: true,
  DURATION_TOO_LONG: true,
  TOO_MANY_CHANNELS: true,
  SAMPLE_RATE_TOO_HIGH: true,
  SESSION_TOO_LARGE: true,
  TOO_MANY_CLIPS: true,
};

function violation(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the limit to be exceeded");
}

describe("audioMessages", () => {
  it("has text for every AudioError code and every limit's warning", () => {
    for (const code of Object.keys(ALL_CODES)) {
      expect(audioMessages, code).toHaveProperty(`errors.${code}`);
    }
    for (const limit of Object.keys(audioLimitDefinitions)) {
      expect(audioMessages, limit).toHaveProperty(`warnings.${limit}`);
    }
    expect(audioMessages).toHaveProperty("warnings.truncated");
  });

  it("is a valid catalogue", () => {
    // createMessages throws on a malformed message in the SDK's own catalogue.
    expect(() => createMessages(audioMessages)).not.toThrow();
  });

  it("describes a limit violation with its details, never its message", () => {
    const messages = createMessages(audioMessages);
    const policy = audioLimits.resolve();
    expect(messages.error(violation(() => policy.check("maxChannels", 12)))).toBe(
      "This recording has 12 channels, which is over the 8-channel limit.",
    );
    expect(messages.error(violation(() => policy.check("maxSampleRate", 384_000)))).toBe(
      "This recording's sample rate is 384,000 Hz, which is over the 192,000 Hz limit.",
    );
    expect(messages.error(violation(() => policy.check("maxSessionSize", 1_600_000_000)))).toBe(
      "The open recordings would use 1.6 GB of memory, which is over the 1.5 GB limit. Remove a recording, or clear the undo history, and try again.",
    );
    expect(messages.error(new AudioError("INVALID_AUDIO", "<script>from the file</script>"))).toBe(
      "This file isn't valid audio, or it's too damaged to open.",
    );
  });

  it("formats sizes, numbers and plurals for the locale", () => {
    const en = createMessages(audioMessages);
    expect(en.t("warnings.maxClips", { actual: 1 })).toBe(
      "This recording has 1 clip. Many clips may be slow to play and export.",
    );
    expect(en.t("errors.TOO_MANY_CLIPS", { maximum: 2_000 })).toBe(
      "A recording can have up to 2,000 clips. Join or delete clips, and try again.",
    );
    expect(en.t("warnings.maxSessionSize", { actual: 800_000_000 })).toBe(
      "The open recordings use 800 MB of memory. Clearing the undo history frees memory.",
    );
    const de = createMessages(audioMessages, { locale: "de" });
    expect(de.t("warnings.maxSampleRate", { actual: 352_800 })).toBe(
      "This recording's sample rate is 352.800 Hz, and it may be slow to edit.",
    );
  });
});
