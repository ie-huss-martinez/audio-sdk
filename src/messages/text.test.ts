import { createMessages } from "@hussmartinez/sdk-core";
import { describe, expect, it } from "vitest";
import { AudioError } from "../core/errors/audio-error.js";
import { audioMessages } from "./en.js";
import { audioErrorText, audioWarningText } from "./text.js";

const messages = createMessages(audioMessages);

describe("audioErrorText", () => {
  it("uses the text for the code and its reason, when the catalogue has one", () => {
    const blocked = new AudioError("UNSUPPORTED_ENVIRONMENT", "blocked", {
      details: { feature: "audio-output", reason: "autoplay-blocked" },
    });
    expect(audioErrorText(messages, blocked)).toBe(
      "The browser didn't let sound start. Press Play to start it.",
    );
    const long = new AudioError("DURATION_TOO_LONG", "long", {
      details: {
        limit: "maxDuration",
        maximum: 10_800_000,
        actual: 10_800_001,
        unit: "milliseconds",
        reason: "plan-too-long",
      },
    });
    expect(audioErrorText(messages, long)).toMatch(
      /^This would make the recording .+ long, which is over the 3 hr limit\.$/,
    );
  });

  it("falls back to the code's text, as messages.error gives it", () => {
    for (const error of [
      new AudioError("UNSUPPORTED_ENVIRONMENT", "no", { details: { feature: "Web Audio" } }),
      new AudioError("INVALID_COMMAND", "no", { details: { reason: "unknown-clip" } }),
      new AudioError("DURATION_TOO_LONG", "no", {
        details: { limit: "maxDuration", maximum: 1_000, actual: 2_000, unit: "milliseconds" },
      }),
      new Error("not ours"),
      "a string",
    ]) {
      expect(audioErrorText(messages, error)).toBe(messages.error(error));
    }
  });

  it("never takes a reason from the error as a key it doesn't know", () => {
    const odd = new AudioError("INVALID_AUDIO", "no", { details: { reason: "__proto__" } });
    expect(audioErrorText(messages, odd)).toBe(messages.error(odd));
  });
});

describe("audioWarningText", () => {
  it("gives every warning its text, with what it needs", () => {
    expect(audioWarningText(messages, { type: "limit", limit: "maxTracks", actual: 12 })).toBe(
      "This recording has 12 tracks. Many tracks may be slow to play and export.",
    );
    expect(
      audioWarningText(messages, { type: "limit", limit: "maxSessionSize", actual: 800_000_000 }),
    ).toBe("The open recordings use 800 MB of memory. Clearing the undo history frees memory.");
    expect(
      audioWarningText(messages, {
        type: "limit",
        limit: "maxDecodedSize",
        actual: 5e8,
        source: "s1",
      }),
    ).toBe("This file is very large once opened and may be slow to process.");
    expect(
      audioWarningText(messages, {
        type: "truncated",
        source: "s1",
        frames: 10,
        declaredFrames: 20,
      }),
    ).toMatch(/^This recording looks incomplete/);
  });
});
