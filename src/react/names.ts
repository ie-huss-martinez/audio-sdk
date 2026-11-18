import type { AudioPlan, AudioTrack } from "../core/model/plan.js";
import type { AudioEditorMessages } from "./editor-messages.js";

/** A track's name as people see it: "Track 2, Music", or "Track 2" without one. */
export function trackName(messages: AudioEditorMessages, track: AudioTrack, index: number): string {
  return track.name
    ? messages.t("timeline.track.named", { index: index + 1, name: track.name })
    : messages.t("timeline.track", { index: index + 1 });
}

/**
 * Some of a plan's tracks, as people hear them: "every track", one track's
 * name, or how many.
 */
export function tracksText(
  messages: AudioEditorMessages,
  plan: AudioPlan | undefined,
  tracks: readonly AudioTrack[],
): string {
  if (plan && tracks.length === plan.tracks.length && tracks.length > 1) {
    return messages.t("tracks.every");
  }
  const [only] = tracks;
  if (tracks.length === 1 && only) {
    return trackName(messages, only, plan ? plan.tracks.indexOf(only) : 0);
  }
  return messages.t("tracks.count", { count: tracks.length });
}
