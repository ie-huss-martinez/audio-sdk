import {
  type AudioOutput,
  type AudioOutputSnapshot,
  type AudioPlan,
  type DecodedAudio,
  planLength,
} from "../../src/index.js";

/** A manual clock for the fake output, in frames. */
export interface FakeClock {
  /** Moves time forward. Playback advances with it while playing. */
  advance(frames: number): void;
}

/** A playback fake: the real output's state machine, driven by a manual clock. */
export function createFakeOutput(): { output: AudioOutput; clock: FakeClock } {
  const listeners = new Set<() => void>();
  let snapshot: AudioOutputSnapshot = { state: "stopped" };
  let plan: AudioPlan | undefined;
  let playhead = 0;
  let destroyed = false;

  const length = () => (plan ? planLength(plan) : 0);
  const assertAlive = () => {
    if (destroyed) throw new Error("The output has been destroyed.");
  };
  const notify = (state: AudioOutputSnapshot["state"]) => {
    snapshot = { state };
    for (const listener of [...listeners]) listener();
  };
  const setState = (state: AudioOutputSnapshot["state"]) => {
    if (snapshot.state !== state) notify(state);
  };
  /** The playhead jumped: a new snapshot in the same state, as the port asks. */
  const jumped = () => notify(snapshot.state);

  const output: AudioOutput = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    position: () => playhead,
    load(next: AudioPlan, _sources: ReadonlyMap<string, DecodedAudio>) {
      assertAlive();
      plan = next;
      const before = playhead;
      playhead = Math.min(playhead, length());
      if (playhead === before) return;
      if (snapshot.state === "playing" && playhead >= length()) setState("stopped");
      else jumped();
    },
    async play() {
      assertAlive();
      if (length() === 0) return;
      if (playhead >= length()) playhead = 0;
      setState("playing");
    },
    pause() {
      assertAlive();
      if (snapshot.state === "playing") setState("paused");
    },
    stop() {
      assertAlive();
      const before = playhead;
      playhead = 0;
      if (snapshot.state !== "stopped") setState("stopped");
      else if (before !== 0) jumped();
    },
    seek(frame) {
      assertAlive();
      const before = playhead;
      playhead = Math.max(0, Math.min(Math.round(frame), length()));
      if (snapshot.state === "playing" && playhead >= length()) setState("stopped");
      else if (playhead !== before) jumped();
    },
    async destroy() {
      destroyed = true;
      setState("stopped");
      listeners.clear();
    },
  };

  const clock: FakeClock = {
    advance(frames) {
      if (snapshot.state !== "playing") return;
      playhead = Math.min(playhead + frames, length());
      if (playhead >= length()) setState("stopped");
    },
  };

  return { output, clock };
}
