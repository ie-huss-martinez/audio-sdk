import type { AudioTrack } from "../core/model/plan.js";
import type { AudioEditorMessages } from "./editor-messages.js";

/** A track's name as people see it: "Track 2, Music", or "Track 2" without one. */
export function trackName(messages: AudioEditorMessages, track: AudioTrack, index: number): string {
  return track.name
    ? messages.t("timeline.track.named", { index: index + 1, name: track.name })
    : messages.t("timeline.track", { index: index + 1 });
}
