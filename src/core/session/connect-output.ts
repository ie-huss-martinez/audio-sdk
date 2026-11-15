import type { AudioPlan } from "../model/plan.js";
import type { DecodedAudio } from "../model/source.js";
import type { AudioOutput } from "../ports/audio-output.js";
import type { AudioSession } from "./session.js";

/**
 * Keeps an output playing what the session holds (docs/adr/0003), so an
 * editor's playback follows every edit, undo and insert:
 *
 * - **on every change of the plan,** the output loads it, with the decoded
 *   sources its clips use. While playing, it carries on from the playhead
 *   with the new plan, as the output port promises;
 * - **when the recording is closed,** or replaced by another, the output
 *   stops, and the playhead goes back to the start. A recording that
 *   replaces another shares none of its sources, because source ids are
 *   never reused; an insert keeps the sources already there.
 *
 * The output stays outside the session's snapshot: its playhead changes on
 * every audio frame, and the session's subscribers shouldn't re-render with
 * it. Returns a function that disconnects them, leaving the output as it is.
 *
 * @example
 * ```ts
 * const session = createAudioSession({ engine, processor });
 * const output = createAudioOutput();
 * const disconnect = connectOutput(session, output);
 * await session.open(file);
 * playButton.onclick = () => output.play();
 * ```
 *
 * @public
 */
export function connectOutput(session: AudioSession, output: AudioOutput): () => void {
  let plan: AudioPlan | undefined;
  /** The source ids the session held at the last change. */
  let held = new Set<string>();

  function sync(): void {
    const snapshot = session.getSnapshot();
    const next = snapshot.plan;
    const ids = new Set(snapshot.sources.map((source) => source.id));
    if (next === plan) {
      held = ids;
      return;
    }
    const replaced =
      next === undefined ||
      (plan !== undefined && !next.clips.some((clip) => held.has(clip.source)));
    if (replaced && plan !== undefined) output.stop();
    plan = next;
    held = ids;
    if (!next) return;
    const sources = new Map<string, DecodedAudio>();
    for (const { source } of next.clips) {
      const audio = session.getAudio(source);
      if (audio) sources.set(source, audio);
    }
    output.load(next, sources);
  }

  sync();
  return session.subscribe(sync);
}
