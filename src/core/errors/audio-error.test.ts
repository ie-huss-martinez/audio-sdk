import { deserializeError, isSdkError, SdkError, serializeError } from "@hussmartinez/sdk-core";
import { describe, expect, it } from "vitest";
import { AudioError, isAudioError } from "./audio-error.js";

describe("AudioError", () => {
  it("carries a code, details and cause, as an SdkError", () => {
    const cause = new DOMException("Unable to decode audio data", "EncodingError");
    const error = new AudioError("DECODE_FAILED", "The browser couldn't decode the file.", {
      details: { codec: "opus" },
      cause,
    });
    expect(error).toBeInstanceOf(SdkError);
    expect(error).toMatchObject({
      name: "AudioError",
      code: "DECODE_FAILED",
      details: { codec: "opus" },
      cause,
    });
    expect(isSdkError(error, "DECODE_FAILED")).toBe(true);
  });

  it("keeps its class, code and details across a worker boundary", () => {
    const original = new AudioError("TOO_MANY_CHANNELS", "Too many channels.", {
      details: { limit: "maxChannels", maximum: 8, actual: 12, unit: "count" },
    });
    // What a worker posts, cloned as postMessage would.
    const received = structuredClone(serializeError(original));
    const rebuilt = deserializeError(received, { errorClasses: { AudioError } });
    expect(rebuilt).toBeInstanceOf(AudioError);
    expect(isAudioError(rebuilt, "TOO_MANY_CHANNELS")).toBe(true);
    expect(rebuilt.details).toEqual(original.details);
  });
});

describe("isAudioError", () => {
  it("recognises an AudioError, and checks its code when given one", () => {
    const error = new AudioError("INVALID_AUDIO", "Truncated header.");
    expect(isAudioError(error)).toBe(true);
    expect(isAudioError(error, "INVALID_AUDIO")).toBe(true);
    expect(isAudioError(error, "UNSUPPORTED_FORMAT")).toBe(false);
  });

  it("rejects other SDK errors and plain values", () => {
    expect(isAudioError(new SdkError("ABORTED", "Stopped."))).toBe(false);
    expect(isAudioError(new Error("INVALID_AUDIO"))).toBe(false);
    expect(isAudioError({ name: "AudioError", code: "INVALID_AUDIO", message: "forged" })).toBe(
      false,
    );
    expect(isAudioError(undefined)).toBe(false);
  });
});
