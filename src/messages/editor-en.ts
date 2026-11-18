import { plural } from "@hussmartinez/sdk-core";

/**
 * The editor's own English text (docs/adr/0005): its regions' names, its
 * states, its transport and its announcements. It's here, apart from
 * `audioMessages`, so the server-safe `.` entry carries no interface text;
 * the React entry joins the two with `ui`'s as `audioEditorMessages`.
 *
 * @internal
 */
export const audioEditorText = {
  "editor.label": "Audio editor",
  "editor.empty": "Drop an audio file here, or choose one. It stays on your device.",
  "editor.opening": "Opening the recording",
  "editor.inserting": "Adding the recording",
  "editor.cancel": "Cancel",
  "editor.opened": "Recording opened.",
  "editor.inserted": "Recording added.",
  "editor.notices": "Notices",
  "editor.dismiss": "Dismiss",
  "editor.historyTrimmed":
    "The earliest edits can no longer be undone, to make room for the recordings.",
  "timeline.label": "Timeline",
  "timeline.summary": /* @__PURE__ */ plural("count", {
    one: "{count} track, {duration} long.",
    other: "{count} tracks, {duration} long.",
  }),
  "timeline.playhead": "Playhead",
  "timeline.zoom": "Zoom",
  "timeline.zoomIn": "Zoom in",
  "timeline.zoomOut": "Zoom out",
  "timeline.zoomFit": "Fit to width",
  // A track's name as people see it, then as a lane's accessible name.
  "timeline.track": "Track {index}",
  "timeline.track.named": "Track {index}, {name}",
  "timeline.lane": "{track}",
  "timeline.lane.muted": "{track}, muted",
  "timeline.lane.silenced": "{track}, silenced by solo",
  "timeline.clips": "Clips on {track}",
  // A clip's accessible name starts with what it shows, its recording's
  // name, when it has one (WCAG 2.5.3).
  "timeline.clip": "Clip {index} of {count} on {track}, {start} to {end}",
  "timeline.clip.named": "{name}, clip {index} of {count} on {track}, {start} to {end}",
  "timeline.clip.gain": "Clip {index} of {count} on {track}, {start} to {end}, {gain, number} dB",
  "timeline.clip.named.gain":
    "{name}, clip {index} of {count} on {track}, {start} to {end}, {gain, number} dB",
  "transport.label": "Playback",
  "transport.play": "Play",
  "transport.pause": "Pause",
  "transport.start": "Back to the start",
  "transport.time": "{position} / {duration}",
} as const;
