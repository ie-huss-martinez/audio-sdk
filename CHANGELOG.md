# @hussmartinez/audio-sdk

## 0.3.1

### Patch Changes

- [#42](https://github.com/ie-huss-martinez/audio-sdk/pull/42) [`07233f9`](https://github.com/ie-huss-martinez/audio-sdk/commit/07233f95c6a9a6492d19c80720c7b3bee600a7bf) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The README now documents the session: opening, editing with commands and undo, and exporting to WAV with `createAudioSession`, `createAudioProcessor` and `session.export()`, in a worked example. It also states what's published, lists the session's and the plan documents' error codes, and points to the portable `hm-audio-plan` format.

## 0.3.0

### Minor Changes

- [#40](https://github.com/ie-huss-martinez/audio-sdk/pull/40) [`b40aa63`](https://github.com/ie-huss-martinez/audio-sdk/commit/b40aa634676a848a1b8130450cc0c002ab327af3) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Adds `session.export({ format, signal, onProgress })`, which renders and encodes the plan with the session's new `processor` option, such as `createAudioProcessor()`, and returns the file as a `Blob`, never downloading it.
  
  - **What's exported:** the plan as it is when the export starts, so edits made while it runs don't change the file.
  - **Limits and cancellation:** the export runs under `maxProcessingTime`, and the caller's `signal` cancels it with `ABORTED`.
  - **Refusals:** an export with no recording open, or of a plan with no clips, fails with `INVALID_COMMAND` and the reason `no-recording` or `empty-plan`.
  - **Events:** a successful export emits an anonymous `recording_exported` event, and a failed one a `failed` event with `operation: "export"`.
  - **Event durations** are now rounded to two significant figures in every event, including `recording_opened` and `recording_inserted`, so an exact length can't fingerprint a recording.

- [#38](https://github.com/ie-huss-martinez/audio-sdk/pull/38) [`59675fe`](https://github.com/ie-huss-martinez/audio-sdk/commit/59675fe364eb1107b53041661eb5560ba564449b) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Adds `createAudioProcessor({ assetsUrl, idleTimeout })`, the SDK's `AudioProcessor`: it renders a plan and encodes it as WAV, in its own worker, block by block, with progress and cancellation.
  
  - **Formats:** 16-bit PCM (the default), 24-bit PCM or 32-bit float, at the plan's sample rate and channel count, as RF64 when the file is over 4 GiB.
  - **Rendering:** each clip's gain and fades, exactly as `gainAt` defines them. Sources with another channel count mix by Web Audio's speaker rules, so export matches playback.
  - **Quantisation:** clamped to full scale, then rounded half away from zero, without dither. A non-finite sample is written as silence.
  - **Metadata:** written as a `LIST`/`INFO` chunk of UTF-8 text. Empty fields are left out.

### Patch Changes

- [#41](https://github.com/ie-huss-martinez/audio-sdk/pull/41) [`b3dde56`](https://github.com/ie-huss-martinez/audio-sdk/commit/b3dde569c9bbe4c652eb9142be3fc4696f3e5a2d) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The 1,000 limit on a metadata value now counts Unicode code points, as the `hm-audio-plan` schema's `maxLength` does, instead of UTF-16 code units, in `audio.setMetadata` and in `readAudioPlanDocument`. Text outside the Basic Multilingual Plane, such as emoji, may now be up to 1,000 characters long, where it was refused past 500.

## 0.2.1

### Patch Changes

- [#36](https://github.com/ie-huss-martinez/audio-sdk/pull/36) [`fc8489f`](https://github.com/ie-huss-martinez/audio-sdk/commit/fc8489f3287c1942193435a9cbefce96ab3e5897) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The JSON Schemas of `hm-audio-plan` and `hm-audio-command` now ship with the package, as `@hussmartinez/audio-sdk/formats/hm-audio-plan/v1.schema.json` and `@hussmartinez/audio-sdk/formats/hm-audio-command/v1.schema.json`, so a host can validate documents against the schemas that match its installed reader (sdk-core ADR 0045, section 8).

## 0.2.0

### Minor Changes

- [#28](https://github.com/ie-huss-martinez/audio-sdk/pull/28) [`0dda45f`](https://github.com/ie-huss-martinez/audio-sdk/commit/0dda45f486554a6dfcc8bc87d7ec736d98d2c758) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Adds `createAudioSession({ engine, filePolicy, onEvent })`, the recording being edited as a framework-agnostic store: a clip plan over decoded sources, edited with `AudioCommand`s, with undo and redo.
  
  - **Opening:** `session.open(file)` checks the file's size before reading it, and its probe against the limits before decoding it. Sources take their channel count and memory from the decoded audio, so a mono AAC file, which probes as two channels, counts as one. A failed open keeps the recording already open, with its history. A newer open or `close()` cancels every load in progress.
  - **Inserting:** `session.insert(file, { at })` adds another recording as one undoable step, splitting the clip at `at`. Recordings at another sample rate are refused with `UNSUPPORTED_FORMAT` until resampling arrives. When the sources would exceed `maxSessionSize`, the oldest history steps that alone hold a source are dropped first, and `historyTrimmed` says so.
  - **Editing:** `execute`, `group`, `undo` and `redo`, with `createKey()` for the keys of new clips. Commands are copied, and those that would exceed `maxClips` fail with `TOO_MANY_CLIPS`.
  - **Warnings:** the snapshot's `warnings` list limits past their warning thresholds, and a `truncated` warning, with text under `warnings.truncated`, for a WAV or AIFF file cut short, which opens with the audio it holds.
  - **Events:** anonymous `onEvent` events for opens, inserts, commands, undo, redo, closes and failures, with durations in seconds and never file names, samples or metadata.

- [#32](https://github.com/ie-huss-martinez/audio-sdk/pull/32) [`f9269e6`](https://github.com/ie-huss-martinez/audio-sdk/commit/f9269e6dde5a7722789d6e521c0ae94bcb12d5d5) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Every `INVALID_COMMAND` error now has a stable `details.reason` token saying why, such as `clip-too-short`, `unknown-clip`, `key-taken` or `no-recording`. Branch on it instead of the message, which is for developers and may change. The tokens are the new `AudioCommandRejection` type, and a clip's own problems are `AudioClipProblem`. They never change meaning once released (sdk-core ADR 0045).

- [#34](https://github.com/ie-huss-martinez/audio-sdk/pull/34) [`2ae8c5c`](https://github.com/ie-huss-martinez/audio-sdk/commit/2ae8c5cb7bccdfa0b895a922bc84e88f2e4dc467) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Adds the clip plan's portable JSON format, `hm-audio-plan` version 1, with JSON Schemas for it and for the user-level commands, and language-neutral conformance vectors (sdk-core ADR 0045).
  
  - **`toAudioPlanDocument(plan, sources)`** writes a plan, with the sources its clips use, as plain JSON-ready data. **`readAudioPlanDocument(json)`** reads one back, and checks it fully. Another format or a later version fails with `UNSUPPORTED_FORMAT`, and anything else wrong fails with the new `INVALID_DOCUMENT` code, with a `details.reason` from `AudioDocumentRejection`. Text for `errors.INVALID_DOCUMENT` is in `audioMessages`.
  - **Commands are strict.** A field a command's type doesn't have now fails with `INVALID_COMMAND` and `malformed-command`, instead of being ignored, as the command schema refuses it.
  - **A reversed trim** is refused as `clip-too-short`, not `invalid-frames`.

- [#31](https://github.com/ie-huss-martinez/audio-sdk/pull/31) [`2bcd2d3`](https://github.com/ie-huss-martinez/audio-sdk/commit/2bcd2d3250a4427f428a3a5e0645d79a1b603a3b) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Uses sdk-core's shared helpers in place of the SDK's own copies, and finishes two changes that waited for sdk-core.
  
  - **`maxSampleRate` errors** now have `details.unit` of `"hertz"`, instead of `"count"`.
  - **Duration text:** `errors.DURATION_TOO_LONG` and `warnings.maxDuration` now state the length, and the limit, such as "This recording is 3 hr, 5 min long, which is over the 3 hr limit." Hosts that override these messages can use `{actual, duration}` and `{maximum, duration}`.
  - **The worker's version check** is sdk-core's handshake: the worker announces its version when it starts, instead of answering a call. A self-hosted worker from another version is still refused with `WORKER_START_FAILED`, naming the asset and both versions. Copy `dist/assets` again with this release, as after every upgrade.
  - **`assetsUrl`** is resolved by sdk-core's `resolveAssetsBase`. A URL with a query or a fragment now throws `TypeError` when the engine is created, because the worker's URL would lose it.
  - **A WebM or Matroska element** whose size is too large to hold exactly fails with `INVALID_AUDIO`.

### Patch Changes

- [#33](https://github.com/ie-huss-martinez/audio-sdk/pull/33) [`9a4d2f4`](https://github.com/ie-huss-martinez/audio-sdk/commit/9a4d2f466de53d3ac1e0247dbc38854db39cc6d4) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Depends on `@hussmartinez/sdk-core` 0.4.1, the current release, so applications that also use other `@hussmartinez` packages resolve one copy of it.

- [#30](https://github.com/ie-huss-martinez/audio-sdk/pull/30) [`6a12f5e`](https://github.com/ie-huss-martinez/audio-sdk/commit/6a12f5ee5877125b4245f61e6f165f56242a0592) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Uses `@hussmartinez/sdk-core` 0.4.0. `clipOffsets` is now built on sdk-core's timeline helpers, with no change in what it returns for any plan the SDK accepts.

## 0.1.0

### Minor Changes

- [#3](https://github.com/ie-huss-martinez/audio-sdk/pull/3) [`c48bb94`](https://github.com/ie-huss-martinez/audio-sdk/commit/c48bb94f026d387f8557fe2ff37cfdf79c7c562c) Thanks [@hussmartinez](https://github.com/hussmartinez)! - First release of `@hussmartinez/audio-sdk`, an audio SDK that works entirely in the browser: audio is opened, edited and exported on the user's device and never uploaded.
  
  - **Package shape:** an ES module package with a server-safe headless core (`@hussmartinez/audio-sdk`), a React entry (`@hussmartinez/audio-sdk/react`), a custom element entry (`@hussmartinez/audio-sdk/element`) and one stylesheet (`@hussmartinez/audio-sdk/styles.css`), which applications import once. React and React DOM 18.3 or later are optional peer dependencies. It depends on `@hussmartinez/sdk-core` 0.3.
  - **Errors:** every failure is an `AudioError` with a stable `code`, such as `INVALID_AUDIO`, `UNSUPPORTED_FORMAT`, `DECODE_FAILED` or `TOO_MANY_CHANNELS`, and structured `details`. `isAudioError(error, code)` checks one, across workers and copies of the package.
  - **Limits for untrusted files:** `audioLimits` adds `maxDuration`, `maxChannels`, `maxSampleRate`, `maxSessionSize` and `maxClips` to the family's limits on file size, file count, decoded size and processing time, with defaults sized for audio: 1 GB per file and 1 GB of decoded audio. Set them with a `filePolicy`; a misspelt limit name throws instead of being ignored.
  - **Translatable text:** `audioMessages` is the English catalogue for every error code and limit warning, for `createMessages` from `@hussmartinez/sdk-core`. Error text comes from the code and its details, never from the error's message. It includes sdk-core's own text, such as the keyboard key names that shortcut hints use.
  - **The clip plan:** `AudioPlan` is the editor's document: clips played back to back, each a range of a decoded source with its own gain and fades, plus the metadata that export writes into the file. Every position is a whole number of frames (`framesToSeconds` and `secondsToFrames` convert at the edges), and `planLength`, `clipLength` and `clipOffsets` measure it. `gainAt(clip, frame)` is the exact gain at any frame, which playback and export share.
  - **Edit commands:** every edit to the clip plan is an `AudioCommand`, plain data named `audio.*`: insert, remove, delete a range, trim, split, move, set gain, set a fade, and set metadata, with the exact inverses undo runs (`audio.restoreClips`, `audio.replaceClips`, `audio.updateClips` and `audio.reorderClips`). Commands carry the keys of any clips they create, so they replay identically. An invalid one, such as a range outside its source, a gain outside `MIN_GAIN_DB` to `MAX_GAIN_DB` or a metadata value over `MAX_METADATA_LENGTH`, fails with `INVALID_COMMAND` and changes nothing.
  - **Contracts for your own engines:** `AudioEngine` probes, decodes and builds waveform peaks, `AudioProcessor` renders and encodes a plan, and `AudioOutput` plays one. Pass your own implementations to replace the SDK's.
  - **Opening WAV and AIFF files:** `createAudioEngine()` probes and parses WAV (PCM, float, extensible and RF64) and AIFF/AIFC files in a Web Worker, block by block, into an `AudioBuffer` at the file's own sample rate, and builds the waveform overview as it reads. A truncated file, as from an interrupted recording or download, opens with the audio it holds, and the probe's `declaredFrames` says how much its header promised. A WAV data size of 0, which streaming writers leave behind, is read to the end of the file only when no other chunk follows it. Other formats fail with `UNSUPPORTED_FORMAT` for now. The worker is inlined, which needs `worker-src blob:` in a Content Security Policy, and it makes no network requests.
  - **Probing FLAC:** `engine.probe()` also reads FLAC files, native (with or without an ID3v2 tag) and in Ogg. It walks every frame to bound how much audio the file can decode to, so a header that claims a shorter or longer length than the frames carry can't get past the file policy's limits.
  - **Opening FLAC:** `engine.decode()` now decodes FLAC, native and in Ogg, with the browser's own decoder at the file's own sample rate. Only files the engine probed are decoded; the result is checked against the probe's bound and refused with `INVALID_AUDIO` if it's longer; a browser that can't decode the file gives `DECODE_FAILED`, never the browser's own message; and when the call's `signal` aborts, for example for the file policy's time limit, the engine stops waiting at once, even if the browser's decoder never finishes. Web Audio is required: without it, decoding compressed files fails with `UNSUPPORTED_ENVIRONMENT`.
  - **Opening MP3 and AAC:** the engine also probes and decodes MP3 (with or without an ID3v2 tag, using a Xing, Info or VBRI tag's length when it's consistent with the frames) and AAC in ADTS. Low-rate AAC opens at twice its core rate, so HE-AAC keeps its full bandwidth. What a browser can decode follows its own codecs.
  - **Opening M4A:** the engine also probes and decodes MP4 and M4A files with one audio track of AAC or ALAC. Every sample must lie inside the file, and the track's duration is used only when it's consistent with its samples. Fragmented MP4 and files with several audio tracks fail with `UNSUPPORTED_FORMAT`.
  - **Opening Opus and Vorbis:** the engine also probes and decodes Opus and Vorbis in Ogg. Opus opens at 48 kHz, as it always decodes, with its pre-skip trimmed by the browser. A file the browser decodes to no audio fails with `DECODE_FAILED`.
  - **Opening WebM:** the engine also probes and decodes WebM and Matroska files with one audio track of Opus, Vorbis, FLAC or AAC, including recordings from `MediaRecorder`, which have no duration and open-ended clusters. A video track in the same file is ignored.
  - **Self-hosting the worker:** `createAudioEngine({ assetsUrl })` loads the worker from your own origin, as `audio/audio.worker.js` under the URL where you serve the package's `dist/assets/` directory. A Content Security Policy then needs `worker-src 'self'` and no `blob:`. Copy `dist/assets` again after every upgrade: a worker from another version is refused with `WORKER_START_FAILED`, which names it.
