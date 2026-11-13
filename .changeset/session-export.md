---
"@hussmartinez/audio-sdk": minor
---

Adds `session.export({ format, signal, onProgress })`, which renders and encodes the plan with the session's new `processor` option, such as `createAudioProcessor()`, and returns the file as a `Blob`, never downloading it.

- **What's exported:** the plan as it is when the export starts, so edits made while it runs don't change the file.
- **Limits and cancellation:** the export runs under `maxProcessingTime`, and the caller's `signal` cancels it with `ABORTED`.
- **Refusals:** an export with no recording open, or of a plan with no clips, fails with `INVALID_COMMAND` and the reason `no-recording` or `empty-plan`.
- **Events:** a successful export emits an anonymous `recording_exported` event, and a failed one a `failed` event with `operation: "export"`.
- **Event durations** are now rounded to two significant figures in every event, including `recording_opened` and `recording_inserted`, so an exact length can't fingerprint a recording.
