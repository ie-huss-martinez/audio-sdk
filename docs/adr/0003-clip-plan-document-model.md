# 0003. The clip plan: edits change a model, and audio is rendered on export

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

The family requires every edit to be a serialisable command, run by a framework-agnostic session with undo and redo ([ADR 0008](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0008-ports-adapters-and-session.md), [ADR 0010](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0010-edits-as-commands.md)). [ADR 0029](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0029-session-store-and-history.md) moves what every session shares into `sdk-core`: `createStore`, `createHistory`, the `Reducer` type and `applyCommands`.

Audio is large, so edits can't copy samples, and undo can't keep snapshots of them. The replaced editor kept its state in thirteen React state variables, in seconds, with no model and no undo. Seconds as floating-point numbers drift, and can't name an exact sample.

`pdf-sdk` solved the same problem with a page plan over immutable sources ([`pdf-sdk` ADR 0003](https://github.com/ie-huss-martinez/pdf-sdk/blob/main/docs/adr/0003-page-plan-document-model.md)). Audio has the same shape: a sequence of pieces of immutable sources.

## Decision

### The model

The session's document is a **clip plan** over immutable sources, plus metadata:

- **Sources:** each opened or inserted file, decoded once into an `AudioBuffer` and never modified ([ADR 0002](0002-workers-and-assets.md)). A source has an id, its sample rate, its channel count, its length in frames, and its waveform peaks.
- **The plan:** the session's sample rate and channel count, and an ordered list of clips, played back to back on one track. Each clip has:
  - **`key`:** stable across edits, so selection and waveform tiles follow a clip that moves;
  - **`source`, `start`, `end`:** the source and the range of its frames the clip plays, `start` inclusive and `end` exclusive;
  - **`gainDb`:** the clip's gain;
  - **`fadeIn`, `fadeOut`:** each `{ frames, curve: "linear" | "equalPower" }`.
- **Metadata:** title, artist, album, year and comment, which export writes into the file ([ADR 0001](0001-audio-engines.md)).

### Time is integer frames

- **Every position and length in the model is a whole number of frames,** at the session's sample rate. Seconds appear only at the edges: in the UI, through `Intl` formatting, and in events.
- **A clip's place on the timeline is derived,** as the sum of the lengths of the clips before it. It's never stored, so it can't disagree with the clips.
- **The session's sample rate and channel count come from its first source.** A source inserted later at another rate is resampled to the session's rate when it's inserted, with an `OfflineAudioContext`, and the session reports it. Other channel counts are mixed with Web Audio's speaker rules for mono, stereo, quad and 5.1, and discretely otherwise. Export uses the same rules, so playback and export agree.

### Commands

Commands are plain, structured-cloneable data, named `audio.*`:

| Command | Changes |
|---|---|
| `audio.insertClips { at, clips }` | Inserts clips at a timeline frame, splitting the clip there if needed |
| `audio.removeClips { keys }` | Removes clips |
| `audio.restoreClips { entries }` | Puts clips back at their indexes, with every field as it was. The inverse of most edits |
| `audio.deleteRange { start, end, keys }` | Removes a timeline range, trimming or splitting the clips it touches |
| `audio.trimClip { key, start, end }` | Changes the source range a clip plays |
| `audio.splitClip { key, at, newKey }` | Splits a clip at a timeline frame into two |
| `audio.moveClips { keys, to }` | Moves clips to a position |
| `audio.setGain { keys, gainDb }` | Sets the gain of clips |
| `audio.setFade { key, edge, frames, curve }` | Sets a clip's fade in or fade out |
| `audio.setMetadata { field, value }` | Sets one metadata field |

- **The reducer is `sdk-core`'s `Reducer<AudioPlan, AudioCommand>`:** a pure function that applies one command and returns its inverse. The session applies sequences with `applyCommands`, which returns the inverses in the order undo needs.
- **Commands carry everything the reducer needs,** so it stays pure. The keys of new clips are in the command (`newKey` in `audio.splitClip`, `keys` in `audio.deleteRange`), and the session generates them before it executes.
- **Invalid commands throw `AudioError` with `INVALID_COMMAND`:** for example, a range outside its source, a clip shorter than one frame, or an unknown key. The UI clamps what people enter, such as a trim past the end, before building a command. The reducer doesn't silently correct a command.
- **Edits keep clips valid.** A trim that leaves a fade longer than its clip shortens the fade. The inverse is `audio.restoreClips`, with the clip's full previous state, so undo restores the fade too.
- **Sources are registered, not carried in commands.** `session.insert(file, { at })` probes the file, checks it against the file policy, decodes it into a new source, and then executes `audio.insertClips` with the source's id. Commands never carry samples.
- **Analysis produces ordinary commands.** "Normalize" measures the selection's peak in the worker, then executes `audio.setGain`. Later loudness tools work the same way.

### The session

- **The store is `sdk-core`'s `createStore`.** The snapshot holds:
  - the status, sources (without samples), the plan and the metadata;
  - the selection, as a timeline range, which is view state outside the history;
  - `canUndo`, `canRedo` and whether history was trimmed;
  - warnings and the last error.
- **The history is `sdk-core`'s `createHistory`,** with `group()` for gestures that make several commands, such as dragging a trim handle or typing into a metadata field, which are one undoable step each.
- **Undo uses inverse commands, never snapshots of samples.** A step costs a few hundred bytes, plus the sources it still refers to, which [ADR 0004](0004-audio-limits.md) counts.
- **The playhead isn't in the session.** It moves sixty times a second during playback, and putting it in the snapshot would re-render everything that reads the session. `AudioOutput` has its own small store, also from `createStore`, with its state (stopped, playing or paused) and a `position()` read from the audio clock, which the playhead's view polls on animation frames. Play and pause take the family's `play-pause` shortcut ([ADR 0030](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0030-tools-and-keyboard-shortcuts.md)).
- **Events:** each command emits an anonymous event with its type and outcome for the host's `onEvent`, with durations in seconds. Events never carry file names, samples or metadata values.

### Exporting

`session.export(options)` renders the plan in the worker, block by block ([ADR 0002](0002-workers-and-assets.md)):

1. **Gather:** for each output block, the page copies the source samples the plan places there.
2. **Render:** the worker mixes them to the session's layout, applies each clip's `gainAt`, and clamps the result.
3. **Encode:** WAV, at the format the caller chose, with the metadata as a `LIST`/`INFO` chunk ([ADR 0001](0001-audio-engines.md)).

The result is a `Blob`. Export never downloads anything itself: the editor shows a summary of the length, format and size before the download ([STANDARDS](https://github.com/ie-huss-martinez/sdk-core/blob/main/STANDARDS.md#ux)), and the host's `onExport` can take the `Blob` instead. Every block is cancellable and reports progress.

### The ports

| Port | Does | Default adapter |
|---|---|---|
| `AudioEngine` | probes and decodes files, builds waveform peaks | the worker's readers and parser, and `decodeAudioData` ([ADR 0001](0001-audio-engines.md)) |
| `AudioProcessor` | renders and encodes a plan | the worker's renderer and WAV encoder |
| `AudioOutput` | plays a plan from a position, and reschedules on changes | Web Audio ([ADR 0002](0002-workers-and-assets.md)) |

The session depends only on the ports. Unit tests run it against fakes, without a browser, and every adapter passes its port's contract tests.

### What the model doesn't cover

- **Multiple tracks:** they would give clips a timeline position (`at`) and mix overlapping clips. The commands above stay valid on one track, so this is an extension, not a rewrite.
- **Edits that change samples in a way the plan can't express,** such as noise reduction or time-stretching: they would add an `audio.materialize` step that renders a range into a new source. Its history entry holds that source, which counts against the session's memory.

## Alternatives considered

- **Edit the samples directly, and keep snapshots for undo:** every edit would copy audio, and a few undo steps of a long file would exhaust memory.
- **Seconds as floating-point numbers:** what the replaced editor used. Positions drift, a trim can't name an exact sample, and two clips can disagree about where one ends and the next begins.
- **A multitrack model from the start:** more power than the first features need, and a harder model to get right. The single track extends to it.
- **The playhead in the session snapshot:** sixty snapshots a second would re-render every subscriber during playback.

## Consequences

- Edits are instant and cost almost no memory: they change a small plan. The audio is rendered once, on export.
- Undo is consistent with `pdf-sdk`'s, because both use `sdk-core`'s history, and the family tests its subtle parts once.
- The session needs `@hussmartinez/sdk-core` 0.2.0, the first release with `createStore` and `createHistory`.
- Command definitions become public API, tracked in the API report ([ADR 0009](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0009-features-as-tools.md)).
