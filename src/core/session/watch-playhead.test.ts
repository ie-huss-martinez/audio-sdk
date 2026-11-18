import { describe, expect, it } from "vitest";
import { createFakeOutput } from "../../../test/fakes/fake-output.js";
import { singleTrack } from "../../../test/helpers/plans.js";
import { NO_FADE } from "../model/plan.js";
import { type AudioFrameScheduler, watchPlayhead } from "./watch-playhead.js";

/** Animation frames that run when the test says. */
function manualFrames() {
  const waiting = new Map<number, () => void>();
  let next = 0;
  const frames: AudioFrameScheduler = {
    request(callback) {
      next += 1;
      waiting.set(next, callback);
      return next;
    },
    cancel(handle) {
      waiting.delete(handle as number);
    },
  };
  return {
    frames,
    get waiting() {
      return waiting.size;
    },
    /** Runs the frames waiting now. */
    flush() {
      const due = [...waiting.values()];
      waiting.clear();
      for (const callback of due) callback();
    },
  };
}

const plan = singleTrack([
  { key: "a", source: "s", start: 0, end: 1_000, gainDb: 0, fadeIn: NO_FADE, fadeOut: NO_FADE },
]);

describe("watchPlayhead", () => {
  it("reports the playhead now, on each animation frame while playing, and only when it moves", async () => {
    const { output, clock } = createFakeOutput();
    output.load(plan, new Map());
    const animation = manualFrames();
    const seen: number[] = [];
    const stop = watchPlayhead(output, (frame) => seen.push(frame), animation.frames);
    expect(seen).toEqual([0]);
    // Nothing plays, so it asks for no frames.
    expect(animation.waiting).toBe(0);
    await output.play();
    expect(animation.waiting).toBe(1);
    clock.advance(100);
    animation.flush();
    animation.flush();
    clock.advance(50);
    animation.flush();
    expect(seen).toEqual([0, 100, 150]);
    output.pause();
    expect(animation.waiting).toBe(0);
    stop();
  });

  it("catches jumps while paused or stopped: a seek, a stop, a shorter plan", async () => {
    const { output, clock } = createFakeOutput();
    output.load(plan, new Map());
    const animation = manualFrames();
    const seen: number[] = [];
    watchPlayhead(output, (frame) => seen.push(frame), animation.frames);
    output.seek(400);
    await output.play();
    clock.advance(100);
    output.pause();
    output.stop();
    output.seek(900);
    output.load(
      singleTrack([{ ...plan.tracks[0]?.clips[0], key: "a", end: 300 } as never]),
      new Map(),
    );
    expect(seen).toEqual([0, 400, 500, 0, 900, 300]);
    expect(animation.waiting).toBe(0);
  });

  it("stops: no more reports, and no frame left waiting", async () => {
    const { output, clock } = createFakeOutput();
    output.load(plan, new Map());
    const animation = manualFrames();
    const seen: number[] = [];
    const stop = watchPlayhead(output, (frame) => seen.push(frame), animation.frames);
    await output.play();
    stop();
    expect(animation.waiting).toBe(0);
    clock.advance(100);
    output.seek(10);
    animation.flush();
    expect(seen).toEqual([0]);
  });

  it("uses the page's animation frames by default, and a timer where there are none", () => {
    const { output } = createFakeOutput();
    const seen: number[] = [];
    const stop = watchPlayhead(output, (frame) => seen.push(frame));
    expect(seen).toEqual([0]);
    stop();
  });
});
