import { describe, expect, it } from "vitest";
import {
  type AudioClip,
  type AudioOutput,
  type AudioPlan,
  type DecodedAudio,
  EMPTY_METADATA,
  NO_FADE,
} from "../../src/index.js";

/**
 * What an output's contract test needs: a way to create the output, and to
 * let time pass while it plays. The Web Audio adapter waits on the audio
 * clock; the fake advances a manual one.
 */
export interface AudioOutputHarness {
  create(): { readonly output: AudioOutput; elapse(frames: number): Promise<void> };
  decoded(sampleRate: number, channels: readonly (readonly number[])[]): DecodedAudio;
  /**
   * How far the playhead may be from where it's expected, in frames, for
   * outputs whose clock runs in real time. 0 for a manual clock.
   */
  readonly positionTolerance: number;
}

const RATE = 8_000;

function clip(key: string, end: number): AudioClip {
  return { key, source: "a", start: 0, end, gainDb: 0, fadeIn: NO_FADE, fadeOut: NO_FADE };
}

function plan(...clips: AudioClip[]): AudioPlan {
  return { sampleRate: RATE, channels: 1, clips, metadata: EMPTY_METADATA };
}

/**
 * The behaviour every {@link AudioOutput} must have (ADR 0002, ADR 0003,
 * ADR 0008). Adapters run it with their own harness.
 */
export function describeAudioOutputContract(name: string, harness: AudioOutputHarness): void {
  describe(`${name}: the AudioOutput contract`, () => {
    const sources = () =>
      new Map([["a", harness.decoded(RATE, [new Array<number>(4_000).fill(0.1)])]]);
    const near = (actual: number, expected: number) =>
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(harness.positionTolerance);

    it("starts stopped at the start", () => {
      const { output } = harness.create();
      expect(output.getSnapshot()).toEqual({ state: "stopped" });
      expect(output.position()).toBe(0);
    });

    it("plays, notifying subscribers, and moves the playhead with the clock", async () => {
      const { output, elapse } = harness.create();
      output.load(plan(clip("a", 4_000)), sources());
      const states: string[] = [];
      output.subscribe(() => states.push(output.getSnapshot().state));
      await output.play();
      await elapse(1_000);
      expect(states).toEqual(["playing"]);
      near(output.position(), 1_000);
      await output.destroy();
    });

    it("pauses and resumes from the same place", async () => {
      const { output, elapse } = harness.create();
      output.load(plan(clip("a", 4_000)), sources());
      await output.play();
      await elapse(1_000);
      output.pause();
      const paused = output.position();
      await elapse(1_000);
      expect(output.getSnapshot().state).toBe("paused");
      expect(output.position()).toBe(paused);
      await output.play();
      await elapse(500);
      near(output.position(), paused + 500);
      await output.destroy();
    });

    it("stops at the end, and plays again from the start", async () => {
      const { output, elapse } = harness.create();
      output.load(plan(clip("a", 1_000), clip("b", 500)), sources());
      await output.play();
      await elapse(2_000);
      expect(output.getSnapshot().state).toBe("stopped");
      expect(output.position()).toBe(1_500);
      await output.play();
      await elapse(100);
      near(output.position(), 100);
      await output.destroy();
    });

    it("seeks within the plan, and keeps playing from there", async () => {
      const { output, elapse } = harness.create();
      output.load(plan(clip("a", 4_000)), sources());
      output.seek(-50);
      expect(output.position()).toBe(0);
      output.seek(10_000);
      expect(output.position()).toBe(4_000);
      output.seek(1_000);
      await output.play();
      output.seek(3_000);
      await elapse(200);
      near(output.position(), 3_200);
      expect(output.getSnapshot().state).toBe("playing");
      await output.destroy();
    });

    it("keeps playing from the playhead when the plan changes, clamping it to a shorter plan", async () => {
      const { output, elapse } = harness.create();
      output.load(plan(clip("a", 4_000)), sources());
      output.seek(3_000);
      output.load(plan(clip("a", 2_000)), sources());
      expect(output.position()).toBe(2_000);
      output.seek(500);
      await output.play();
      output.load(plan(clip("a", 1_000), clip("b", 1_000)), sources());
      await elapse(500);
      near(output.position(), 1_000);
      expect(output.getSnapshot().state).toBe("playing");
      await output.destroy();
    });

    it("stops back to the start, and doesn't play an empty plan", async () => {
      const { output, elapse } = harness.create();
      output.load(plan(clip("a", 4_000)), sources());
      await output.play();
      await elapse(1_000);
      output.stop();
      expect(output.getSnapshot().state).toBe("stopped");
      expect(output.position()).toBe(0);
      output.load(plan(), sources());
      await output.play();
      expect(output.getSnapshot().state).toBe("stopped");
      await output.destroy();
    });

    it("throws on calls after destroy", async () => {
      const { output } = harness.create();
      await output.destroy();
      expect(() => output.load(plan(), sources())).toThrow();
      await expect(output.play()).rejects.toThrow();
    });
  });
}
