import { createStore } from "@hussmartinez/sdk-core";
import { AudioError } from "../core/errors/audio-error.js";
import { type AudioPlan, planLength } from "../core/model/plan.js";
import type { DecodedAudio } from "../core/model/source.js";
import type {
  AudioOutput,
  AudioOutputSnapshot,
  AudioOutputState,
} from "../core/ports/audio-output.js";
import { type ScheduledPlan, sameClips, schedulePlan } from "./web-audio/play-graph.js";

/**
 * How far ahead of the context's clock playback starts, in seconds, so the
 * first clip is scheduled in time.
 */
export const START_LEAD = 0.03;

/**
 * How long `play()` waits for the context to run, in milliseconds. A
 * context stays suspended without a user gesture, or without a sound
 * server, as in Firefox in the browser test image (sdk-core ADR 0043).
 */
export const RESUME_TIMEOUT = 2_000;

/**
 * What the output needs from the page, replaceable in tests.
 *
 * @internal
 */
export interface OutputEnvironment {
  readonly createContext: () => AudioContext;
}

/**
 * Creates the SDK's playback output (docs/adr/0002): it plays a plan
 * through Web Audio, from the playhead, and reschedules from the playhead
 * whenever the plan changes or it seeks, so an edit or a seek during
 * playback always takes effect.
 *
 * - **One `AudioContext`,** created on the first `play()`, which should be
 *   a user gesture, as browsers' autoplay rules require. If the context
 *   doesn't run within two seconds, `play()` rejects with
 *   `UNSUPPORTED_ENVIRONMENT` and `details.reason` `"autoplay-blocked"`,
 *   and the output stays as it was.
 * - **Each clip is an `AudioBufferSourceNode`** on its source, through a
 *   `GainNode` automated from `gainAt`, so playback follows the envelope
 *   export applies. Sources mix into the plan's channels by Web Audio's
 *   speaker rules, as export does.
 * - **Each track is a `GainNode`** its clips feed, at the track's gain, or
 *   at silence when it's muted or left out by a solo, and the tracks feed
 *   one at the master gain. Loading a plan that differs only in those
 *   levels moves the nodes there over 5 ms, and reschedules nothing, so a
 *   mute, a solo or a gain is heard at once, without a gap or a click
 *   (docs/adr/0006).
 * - **The playhead** is read from the audio clock by `position()`, which a
 *   view polls on animation frames; it isn't in the snapshot.
 *
 * Sources should be `AudioBuffer`s, as `createAudioEngine` decodes them.
 * Others are copied into one once, on first use.
 *
 * @example
 * ```ts
 * const output = createAudioOutput();
 * output.load(plan, sources);
 * playButton.onclick = () => output.play();
 * requestAnimationFrame(function draw() {
 *   drawPlayhead(output.position());
 *   requestAnimationFrame(draw);
 * });
 * ```
 *
 * @public
 */
export function createAudioOutput(): AudioOutput {
  return createOutput({ createContext: () => new AudioContext() });
}

/**
 * The output, with its environment passed in.
 *
 * @internal
 */
export function createOutput(environment: OutputEnvironment): AudioOutput {
  const store = createStore<AudioOutputSnapshot>(Object.freeze({ state: "stopped" }));
  const copies = new WeakMap<DecodedAudio, AudioBuffer>();
  let context: AudioContext | undefined;
  let plan: AudioPlan | undefined;
  let sources: ReadonlyMap<string, DecodedAudio> = new Map();
  /** The playhead while not playing. */
  let playhead = 0;
  /** While playing: what's scheduled, and which frame plays at which context time. */
  let playing: { scheduled: ScheduledPlan; frame: number; time: number } | undefined;
  let endTimer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;

  const length = () => (plan ? planLength(plan) : 0);
  const assertAlive = () => {
    if (destroyed) throw new Error("The audio output has been destroyed.");
  };
  const setState = (state: AudioOutputState) => {
    if (store.getSnapshot().state !== state) store.set(Object.freeze({ state }));
  };
  /**
   * Tells subscribers the playhead jumped, with a new snapshot in the same
   * state, so a view that reads `position()` on changes catches a seek, a
   * stop, or a plan that moves it, even while paused (point 8 of #54).
   */
  const jumped = () => store.set(Object.freeze({ state: store.getSnapshot().state }));

  /** A source as an `AudioBuffer`, copied into one once if it isn't. */
  function buffer(id: string): AudioBuffer {
    const audio = sources.get(id);
    if (!audio) throw new TypeError(`The plan's source ${id} isn't loaded.`);
    if (audio instanceof AudioBuffer) return audio;
    let copy = copies.get(audio);
    if (!copy) {
      copy = new AudioBuffer({
        length: audio.length,
        numberOfChannels: audio.numberOfChannels,
        sampleRate: audio.sampleRate,
      });
      for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
        copy.copyToChannel(Float32Array.from(audio.getChannelData(channel)), channel);
      }
      copies.set(audio, copy);
    }
    return copy;
  }

  /** Where the playhead is: from the audio clock while playing. */
  function position(): number {
    if (!playing || !context || !plan) return playhead;
    const elapsed = Math.max(0, context.currentTime - playing.time);
    return Math.min(length(), Math.floor(playing.frame + elapsed * plan.sampleRate));
  }

  /** Stops what's scheduled, keeping the playhead where it is now. */
  function unschedule(): void {
    if (!playing) return;
    playhead = position();
    playing.scheduled.stop();
    playing = undefined;
    clearTimeout(endTimer);
    endTimer = undefined;
  }

  /** Waits for the end of the plan, by the audio clock. */
  function watchEnd(): void {
    clearTimeout(endTimer);
    if (!playing || !context || !plan) return;
    const remaining =
      playing.time - context.currentTime + (length() - playing.frame) / plan.sampleRate;
    endTimer = setTimeout(
      () => {
        if (position() >= length()) {
          unschedule();
          playhead = length();
          setState("stopped");
        } else {
          watchEnd();
        }
      },
      Math.max(0, remaining * 1_000) + 5,
    );
  }

  /** Schedules the plan from the playhead, on a running context. */
  function schedule(): void {
    if (!context || !plan) return;
    const time = context.currentTime + START_LEAD;
    playing = {
      scheduled: schedulePlan(context, context.destination, plan, buffer, playhead, time),
      frame: playhead,
      time,
    };
    watchEnd();
  }

  async function running(audio: AudioContext): Promise<boolean> {
    if (audio.state === "running") return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), RESUME_TIMEOUT);
    });
    try {
      await Promise.race([audio.resume().then(() => true), timedOut]);
    } finally {
      clearTimeout(timer);
    }
    // resume() changes the state while this waits, which TypeScript can't see.
    return (audio.state as AudioContextState) === "running";
  }

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    position,

    load(next, nextSources) {
      assertAlive();
      // A plan with the same clips differs only in levels: a track's gain,
      // mute or solo, or the master gain. Those are set on what's playing,
      // without rescheduling a clip (docs/adr/0006).
      if (playing && context && plan && sameClips(plan, next)) {
        plan = next;
        sources = nextSources;
        playing.scheduled.setLevels(next, context.currentTime);
        return;
      }
      const wasPlaying = playing !== undefined;
      unschedule();
      plan = next;
      sources = nextSources;
      const before = playhead;
      playhead = Math.min(playhead, length());
      if (!wasPlaying) {
        if (playhead !== before) jumped();
        return;
      }
      if (playhead >= length()) {
        playhead = length();
        setState("stopped");
      } else {
        schedule();
      }
    },

    async play() {
      assertAlive();
      if (length() === 0 || playing) return;
      context ??= environment.createContext();
      if (!(await running(context))) {
        throw new AudioError(
          "UNSUPPORTED_ENVIRONMENT",
          "The browser didn't start audio output. Play from a click or a key press.",
          // Most often a browser's autoplay rule, which a click lifts
          // (point 9 of #54): the reason lets an editor say so.
          { details: { feature: "audio-output", reason: "autoplay-blocked" } },
        );
      }
      // Another call may have started, or the plan changed, while waiting.
      if (destroyed || playing || length() === 0) return;
      if (playhead >= length()) playhead = 0;
      schedule();
      setState("playing");
    },

    pause() {
      assertAlive();
      if (!playing) return;
      unschedule();
      setState("paused");
    },

    stop() {
      assertAlive();
      unschedule();
      const before = playhead;
      playhead = 0;
      if (store.getSnapshot().state !== "stopped") setState("stopped");
      else if (before !== 0) jumped();
    },

    seek(frame) {
      assertAlive();
      const wasPlaying = playing !== undefined;
      const before = position();
      unschedule();
      playhead = Math.max(0, Math.min(Math.round(frame), length()));
      if (wasPlaying && playhead < length()) schedule();
      if (wasPlaying && playhead >= length()) setState("stopped");
      else if (playhead !== before) jumped();
    },

    async destroy() {
      if (destroyed) return;
      destroyed = true;
      unschedule();
      setState("stopped");
      await context?.close().catch(() => {});
      context = undefined;
    },
  };
}
