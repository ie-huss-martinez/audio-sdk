---
"@hussmartinez/audio-sdk": minor
---

A new usage event, `recording_downloaded`, comes through `onEvent` (and the element's `hm-audio-editor-event`) each time the export dialog's Download button saves the file. It carries the same facts as `recording_exported`, the rounded length, sample rate, channels and sample format, and nothing about the file's name or contents. `recording_exported` still comes when the file is ready, before it's saved. So if you guard against leaving with unsaved work, clear the guard on `recording_downloaded`. When you pass `onExport`, you save the file yourself, and `recording_downloaded` never comes. `AudioSessionEvent`'s type union gains the new type; a `switch` over `event.type` that checks for exhaustiveness needs a case for it.
