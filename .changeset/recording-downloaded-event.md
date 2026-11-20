---
"@hussmartinez/audio-sdk": minor
---

A new usage event, `recording_downloaded`, comes through `onEvent` (and the element's `hm-audio-editor-event`) each time the export dialog's Download button starts the browser's download. It carries the same facts as `recording_exported`, the rounded length, sample rate, channels and sample format, and nothing about the file's name or contents.

`recording_exported` still comes when the file is ready, before any download starts, so `recording_downloaded` is the later and better signal for a guard against leaving with unsaved work. It still isn't a confirmed save: a page can't learn whether the browser saved the file or the person cancelled it. The file also holds the plan as its export started, so keep your guard for any change your own code made to the plan during the export. If you need a confirmed save, pass `onExport`, save the `Blob` yourself, and clear your guard when that succeeds; `recording_downloaded` never comes then.

`AudioSessionEvent`'s type union gains the new type, so a `switch` over `event.type` that checks for exhaustiveness needs a case for it.
