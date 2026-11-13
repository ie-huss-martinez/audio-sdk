---
"@hussmartinez/audio-sdk": minor
---

Adds `createAudioSession({ engine, filePolicy, onEvent })`, the recording being edited as a framework-agnostic store: a clip plan over decoded sources, edited with `AudioCommand`s, with undo and redo.

- **Opening:** `session.open(file)` checks the file's size before reading it, and its probe against the limits before decoding it. Sources take their channel count and memory from the decoded audio, so a mono AAC file, which probes as two channels, counts as one. A failed open keeps the recording already open, with its history. A newer open or `close()` cancels every load in progress.
- **Inserting:** `session.insert(file, { at })` adds another recording as one undoable step, splitting the clip at `at`. Recordings at another sample rate are refused with `UNSUPPORTED_FORMAT` until resampling arrives. When the sources would exceed `maxSessionSize`, the oldest history steps that alone hold a source are dropped first, and `historyTrimmed` says so.
- **Editing:** `execute`, `group`, `undo` and `redo`, with `createKey()` for the keys of new clips. Commands are copied, and those that would exceed `maxClips` fail with `TOO_MANY_CLIPS`.
- **Warnings:** the snapshot's `warnings` list limits past their warning thresholds, and a `truncated` warning, with text under `warnings.truncated`, for a WAV or AIFF file cut short, which opens with the audio it holds.
- **Events:** anonymous `onEvent` events for opens, inserts, commands, undo, redo, closes and failures, with durations in seconds and never file names, samples or metadata.
