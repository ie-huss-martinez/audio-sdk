import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutput, RESUME_TIMEOUT } from "../../src/adapters/audio-output.js";
import { NO_FADE } from "../../src/index.js";
import { singleTrack } from "../helpers/plans.js";

describe("the Web Audio output, when the browser won't start sound", () => {
  afterEach(() => vi.useRealTimers());

  it("rejects play() with the reason autoplay-blocked, and stays as it was", async () => {
    vi.useFakeTimers();
    // A context that never leaves "suspended", as under an autoplay rule.
    const context = {
      state: "suspended",
      currentTime: 0,
      resume: () => new Promise<void>(() => {}),
      close: async () => {},
    };
    const output = createOutput({ createContext: () => context as unknown as AudioContext });
    output.load(
      singleTrack([
        { key: "a", source: "s", start: 0, end: 100, gainDb: 0, fadeIn: NO_FADE, fadeOut: NO_FADE },
      ]),
      new Map(),
    );
    const playing = output.play();
    const settled = expect(playing).rejects.toMatchObject({
      code: "UNSUPPORTED_ENVIRONMENT",
      details: { feature: "audio-output", reason: "autoplay-blocked" },
    });
    await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT);
    await settled;
    expect(output.getSnapshot()).toEqual({ state: "stopped" });
    expect(output.position()).toBe(0);
  });
});
