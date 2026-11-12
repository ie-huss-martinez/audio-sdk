import type { AudioPlan } from "../model/plan.js";
import type { DecodedAudio } from "../model/source.js";

/**
 * Whether the output is playing.
 *
 * @public
 */
export type AudioOutputState = "stopped" | "playing" | "paused";

/**
 * The output's state, for `useSyncExternalStore`. A new object on every
 * change. The playhead isn't in it, because it changes on every audio frame
 * (ADR 0003); read it with {@link AudioOutput.position}.
 *
 * @public
 */
export interface AudioOutputSnapshot {
  readonly state: AudioOutputState;
}

/**
 * The port for playback (ADR 0002, ADR 0003, ADR 0008). Playback is a
 * function of the plan and the playhead: loading a changed plan or seeking
 * while playing reschedules from the current position. The SDK's own
 * adapter plays through Web Audio; tests use a fake with a manual clock.
 *
 * Positions are frames on the plan's timeline, from 0 to the plan's length.
 *
 * @public
 */
export interface AudioOutput {
  getSnapshot(): AudioOutputSnapshot;
  /** Calls the listener after every change of state. Returns a function that unsubscribes. */
  subscribe(listener: () => void): () => void;
  /** The playhead, in frames, read from the audio clock. */
  position(): number;
  /**
   * Sets what plays: the plan and the decoded sources its clips refer to.
   * While playing, playback continues from the current position with the
   * new plan. A playhead past the new plan's end moves to its end.
   */
  load(plan: AudioPlan, sources: ReadonlyMap<string, DecodedAudio>): void;
  /**
   * Plays from the playhead, or from the start when the playhead is at the
   * end. The first call may need a user gesture, as browsers' autoplay rules
   * require. When playback reaches the end, the state becomes `stopped` and
   * the playhead stays at the end.
   */
  play(): Promise<void>;
  /** Pauses, keeping the playhead. */
  pause(): void;
  /** Stops, and moves the playhead to the start. */
  stop(): void;
  /** Moves the playhead, clamped to the plan. While playing, playback continues from there. */
  seek(frame: number): void;
  /** Stops playback and releases the audio device. Later calls throw. */
  destroy(): Promise<void>;
}
