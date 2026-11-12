import { SdkError } from "@hussmartinez/sdk-core";
import { describe, expect, it } from "vitest";
import { abortError, throwIfAborted } from "./abort.js";
import { AudioError } from "./audio-error.js";

function aborted(reason?: unknown): AbortSignal {
  const controller = new AbortController();
  controller.abort(reason);
  return controller.signal;
}

describe("abortError", () => {
  it("is ABORTED for a plain abort, with the reason as cause", () => {
    const signal = aborted();
    expect(abortError(signal)).toMatchObject({ name: "AudioError", code: "ABORTED" });
    expect(abortError(signal).cause).toBe(signal.reason);
  });

  it("is TIMEOUT for a timeout", () => {
    const reason = new DOMException("Timed out", "TimeoutError");
    expect(abortError(aborted(reason))).toMatchObject({ code: "TIMEOUT", cause: reason });
  });

  it("keeps an SdkError reason's code and details, such as a time limit's", () => {
    const limit = new SdkError("PROCESSING_TIME_EXCEEDED", "Too slow.", {
      details: {
        limit: "maxProcessingTime",
        maximum: 120_000,
        actual: 120_001,
        unit: "milliseconds",
      },
    });
    const error = abortError(aborted(limit));
    expect(error).toBeInstanceOf(AudioError);
    expect(error).toMatchObject({ code: "PROCESSING_TIME_EXCEEDED", details: limit.details });
  });

  it("returns a AudioError reason unchanged", () => {
    const reason = new AudioError("TOO_MANY_CLIPS", "Too many.");
    expect(abortError(aborted(reason))).toBe(reason);
  });
});

describe("throwIfAborted", () => {
  it("throws only for an aborted signal", () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
    expect(() => throwIfAborted(new AbortController().signal)).not.toThrow();
    expect(() => throwIfAborted(aborted())).toThrow(expect.objectContaining({ code: "ABORTED" }));
  });
});
