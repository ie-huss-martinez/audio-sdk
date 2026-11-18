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
  "transport.label": "Playback",
  "transport.play": "Play",
  "transport.pause": "Pause",
  "transport.start": "Back to the start",
  "transport.time": "{position} / {duration}",
} as const;
