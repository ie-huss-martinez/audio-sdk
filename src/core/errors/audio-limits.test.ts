import { checkFile, coreLimits } from "@hussmartinez/sdk-core";
import { describe, expect, it } from "vitest";
import { isAudioError } from "./audio-error.js";
import { audioLimitDefinitions, audioLimits } from "./audio-limits.js";

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

describe("audioLimits", () => {
  it("keeps every core limit, with its code and unit", () => {
    for (const [name, definition] of Object.entries(coreLimits)) {
      expect(audioLimitDefinitions).toHaveProperty(name);
      const audio = audioLimitDefinitions[name as keyof typeof coreLimits];
      expect(audio.code, name).toBe(definition.code);
      expect(audio.unit, name).toBe(definition.unit);
    }
  });

  it("has the audio defaults of ADR 0004", () => {
    const infinity = Number.POSITIVE_INFINITY;
    expect(audioLimits.resolve().limits).toEqual({
      maxFileSize: { maximum: 1_000_000_000, warning: 250_000_000 },
      maxFiles: { maximum: 20, warning: infinity },
      maxDecodedSize: { maximum: 1_000_000_000, warning: 400_000_000 },
      maxProcessingTime: { maximum: 120_000, warning: infinity },
      maxDuration: { maximum: 10_800_000, warning: 3_600_000 },
      maxChannels: { maximum: 8, warning: infinity },
      maxSampleRate: { maximum: 192_000, warning: infinity },
      maxSessionSize: { maximum: 1_500_000_000, warning: 750_000_000 },
      maxClips: { maximum: 2_000, warning: infinity },
    });
  });

  it("throws an AudioError naming the limit, and warns from the threshold", () => {
    const policy = audioLimits.resolve();
    const hour = 3_600_000;
    expect(policy.check("maxDuration", hour - 1)).toBeUndefined();
    expect(policy.check("maxDuration", hour)).toBe("warning");
    expect(policy.check("maxDuration", 3 * hour)).toBe("warning");

    const thrown = thrownBy(() => policy.check("maxDuration", 3 * hour + 1));
    expect(isAudioError(thrown, "DURATION_TOO_LONG")).toBe(true);
    expect((thrown as { details?: unknown }).details).toEqual({
      limit: "maxDuration",
      maximum: 3 * hour,
      actual: 3 * hour + 1,
      unit: "milliseconds",
    });
  });

  it.each([
    ["maxChannels", 9, "TOO_MANY_CHANNELS"],
    ["maxSampleRate", 384_000, "SAMPLE_RATE_TOO_HIGH"],
    ["maxSessionSize", 2e9, "SESSION_TOO_LARGE"],
    ["maxClips", 2_001, "TOO_MANY_CLIPS"],
  ] as const)("throws %s violations with their own code", (limit, actual, code) => {
    const policy = audioLimits.resolve();
    expect(
      isAudioError(
        thrownBy(() => policy.check(limit, actual)),
        code,
      ),
    ).toBe(true);
  });

  it("throws core limit violations as AudioError too", () => {
    const policy = audioLimits.resolve({ maxFileSize: 10 });
    const file = new Blob([new Uint8Array(11)]);
    expect(() => checkFile(policy, file)).toThrow(
      expect.objectContaining({ name: "AudioError", code: "FILE_TOO_LARGE" }),
    );
    expect(
      isAudioError(
        thrownBy(() => audioLimits.resolve().check("maxDecodedSize", 1_000_000_001)),
        "DECODED_SIZE_TOO_LARGE",
      ),
    ).toBe(true);
  });

  it("applies a host's settings, and rejects unknown names and invalid values", () => {
    const policy = audioLimits.resolve({
      maxDecodedSize: 2e9,
      maxSessionSize: { maximum: 3e9, warning: 1.5e9 },
    });
    expect(policy.limits.maxDecodedSize).toEqual({ maximum: 2e9, warning: 400_000_000 });
    expect(policy.limits.maxSessionSize).toEqual({ maximum: 3e9, warning: 1.5e9 });

    // A typo must not silently leave the default in place (ADR 0020).
    expect(() => audioLimits.resolve({ maxDurations: 10 } as never)).toThrow(TypeError);
    expect(() => audioLimits.resolve({ maxChannels: 0 })).toThrow(RangeError);
    expect(() => audioLimits.resolve({ maxClips: { maximum: 10, warn: 5 } as never })).toThrow(
      TypeError,
    );
  });
});
