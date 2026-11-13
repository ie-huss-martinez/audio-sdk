# 0003. The clip plan: edits change a model, and audio is rendered on export

- **Status:** Accepted
- **Date:** 2026-11-12
- **Amended:** 2026-11-12, to match the model as built in #8: the metadata is a field of the plan, the core sees sources as `DecodedAudio`, and fades reach silence on a clip's first and last frames.
- **Amended:** 2026-11-13, to match the commands as built: three inverse commands (`audio.replaceClips`, `audio.updateClips` and `audio.reorderClips`), the keys of split parts (`splitKey`, `newKey`), how cut clips keep their fades, the bounds on gain and metadata, and the reducer's lookup of source lengths.
- **Amended:** 2026-11-13, to match the session as built: its sources' channels and sizes come from the decoded audio, its warnings include truncated recordings, it generates keys, and inserting at another sample rate waits for resampling.

## Context

The family requires every edit to be a serialisable command, run by a framework-agnostic session with undo and redo ([ADR 0008](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0008-ports-adapters-and-session.md), [ADR 0010](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0010-edits-as-commands.md)). [ADR 0029](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0029-session-store-and-history.md) moves what every session shares into `sdk-core`: `createStore`, `createHistory`, the `Reducer` type and `applyCommands`.

Audio is large, so edits can't copy samples, and undo can't keep snapshots of them. The replaced editor kept its state in thirteen React state variables, in seconds, with no model and no undo. Seconds as floating-point numbers drift, and can't name an exact sample.

`pdf-sdk` solved the same problem with a page plan over immutable sources ([`pdf-sdk` ADR 0003](https://github.com/ie-huss-martinez/pdf-sdk/blob/main/docs/adr/0003-page-plan-document-model.md)). Audio has the same shape: a sequence of pieces of immutable sources.

## Decision

### The model

The session's document is a **clip plan** over immutable sources, plus metadata:

- **Sources:** each opened or inserted file, decoded once into an `AudioBuffer` and never modified ([ADR 0002](0002-workers-and-assets.md)). The core sees a source as `DecodedAudio`, the part of `AudioBuffer` it needs (sample rate, length, channel count and each channel's samples), so it uses no DOM types and tests can supply their own. A source has an id, its sample rate, its channel count, its length in frames, and its waveform peaks.
- **The plan:** the session's sample rate and channel count, an ordered list of clips, played back to back on one track, and the metadata. Each clip has:
  - **`key`:** stable across edits, so selection and waveform tiles follow a clip that moves;
  - **`source`, `start`, `end`:** the source and the range of its frames the clip plays, `start` inclusive and `end` exclusive;
  - **`gainDb`:** the clip's gain;
  - **`fadeIn`, `fadeOut`:** each `{ frames, curve: "linear" | "equalPower" }`. A fade in starts at silence on the clip's first frame, and a fade out reaches silence on its last frame, so a faded clip never starts or ends with a click. Equal-power fades follow a quarter sine.
- **Metadata:** title, artist, album, year and comment, which export writes into the file ([ADR 0001](0001-audio-engines.md)). It's part of the plan, because `audio.setMetadata` is a command that the plan's reducer applies and undoes like any other.

### Time is integer frames

- **Every position and length in the model is a whole number of frames,** at the session's sample rate. Seconds appear only at the edges: in the UI, through `Intl` formatting, and in events.
- **A clip's place on the timeline is derived,** as the sum of the lengths of the clips before it. It's never stored, so it can't disagree with the clips.
- **The session's sample rate and channel count come from its first source,** as decoded: a probe's channel count is only a maximum, and mono AAC probes as two channels. A source inserted later at another rate is resampled to the session's rate when it's inserted, with an `OfflineAudioContext`, and the session reports it. Until the engine can resample, such an insert fails with `UNSUPPORTED_FORMAT` before decoding. Other channel counts are mixed with Web Audio's speaker rules for mono, stereo, quad and 5.1, and discretely otherwise. Export uses the same rules, so playback and export agree.

### Commands

Commands are plain, structured-cloneable data, named `audio.*`:

| Command | Changes | Inverse |
|---|---|---|
| `audio.insertClips { at, clips, splitKey? }` | Inserts clips at a timeline frame. If the frame is inside a clip, that clip splits there, and its second part takes `splitKey` | `audio.replaceClips` |
| `audio.removeClips { keys }` | Removes clips | `audio.restoreClips` |
| `audio.restoreClips { entries }` | Puts clips back at their indexes, with every field as it was | `audio.removeClips` |
| `audio.replaceClips { index, count, clips }` | Replaces a run of neighbouring clips | `audio.replaceClips` |
| `audio.updateClips { clips }` | Sets clips, matched by key, to new states with every field given | `audio.updateClips` |
| `audio.deleteRange { start, end, newKey? }` | Removes a timeline range, trimming the clips at its edges. A range inside one clip splits it, and the part after the range takes `newKey` | `audio.replaceClips` |
| `audio.trimClip { key, start, end }` | Changes the source range a clip plays | `audio.updateClips` |
| `audio.splitClip { key, at, newKey }` | Splits a clip in two at a timeline frame strictly inside it | `audio.replaceClips` |
| `audio.moveClips { keys, to }` | Moves clips, as a block in plan order, to an index of the result | `audio.reorderClips` |
| `audio.reorderClips { order }` | Puts every clip in a new order | `audio.reorderClips` |
| `audio.setGain { keys, gainDb }` | Sets the gain of clips | `audio.updateClips` |
| `audio.setFade { key, edge, frames, curve }` | Sets a clip's fade in or fade out | `audio.updateClips` |
| `audio.setMetadata { field, value }` | Sets one metadata field | `audio.setMetadata` |

Every inverse is exact: it carries the previous state of what the command changed, so undo restores every field, fades included. The inverse commands are public too, so hosts can replay a stored history.

- **The reducer is `sdk-core`'s `Reducer<AudioPlan, AudioCommand>`:** a pure function that applies one command and returns its inverse. The session applies sequences with `applyCommands`, which returns the inverses in the order undo needs.
- **Commands carry everything the reducer needs,** so it stays pure. The keys of new clips are in the command (`splitKey` in `audio.insertClips`, `newKey` in `audio.splitClip` and `audio.deleteRange`), and the session generates them before it executes. Source lengths are the one thing the reducer looks up: the session creates it with a lookup of its registered sources, which never change, so the same command on the same plan always gives the same result.
- **Cut clips keep the fades of the edges they keep.** When a split, an insert or a range deletion cuts a clip, each part keeps the fade of the clip's edge it shares, and has no fade at the cut.
- **Invalid commands throw `AudioError` with `INVALID_COMMAND`:** for example, a range outside its source, a clip shorter than one frame, an unknown or repeated key, a gain outside −120 to +120 dB, or a metadata value over 1,000 characters. The bounds keep every gain a finite factor and every history step small. Commands may come from storage, so the reducer checks their shape, not only their values; its `details` name only the command's type. The UI clamps what people enter, such as a trim past the end, before building a command. The reducer doesn't silently correct a command.
- **Edits keep clips valid.** A trim or a cut that leaves fades longer than their clip shortens both in proportion. `audio.setFade` is the exception: a fade that doesn't fit is the UI's to clamp, so it fails. A plan may have no clips at all, after deleting everything, and export refuses an empty plan.
- **Sources are registered, not carried in commands.** `session.insert(file, { at })` probes the file, checks it against the file policy, decodes it into a new source, and then executes `audio.insertClips` with the source's id. Commands never carry samples.
- **Analysis produces ordinary commands.** "Normalize" measures the selection's peak in the worker, then executes `audio.setGain`. Later loudness tools work the same way.

### The session

- **The store is `sdk-core`'s `createStore`.** The snapshot holds:
  - the status, sources (without samples), and the plan with its metadata, which is `undefined` while no recording is open;
  - the selection, as a timeline range, which is view state outside the history and follows the plan as it shrinks;
  - `canUndo`, `canRedo` and whether history was trimmed;
  - the decoded bytes held, warnings and the last error.
- **Warnings are per source or per session.** A source keeps the warnings from its own checks: limits past their warning thresholds, and `truncated` for an uncompressed recording cut short, with the frames it holds and the frames its header declares ([ADR 0001](0001-audio-engines.md)). They leave the snapshot with the source. `maxSessionSize` and `maxClips` warnings follow the session as it changes.
- **The session generates keys.** `createKey()` returns a key that no clip has, in the plan or in any history step, so that undo and redo never collide with it. Hosts building commands that create clips, such as `audio.splitClip`, take their keys from it.
- **Commands are copied when they're executed,** with `structuredClone`, so the history can't change under the host, and a command that isn't plain data fails with `INVALID_COMMAND`.
- **Opens and closes supersede loads.** A newer open or a close cancels every open and insert in progress. A load that finishes afterwards changes nothing and reports nothing, because the newer operation reports its own outcome.
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
- The session needs `@hussmartinez/sdk-core` 0.3.0, the first published release with `createStore`, `createHistory` and `applyCommands` (0.2.0 was never published).
- Command definitions become public API, tracked in the API report ([ADR 0009](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0009-features-as-tools.md)).
