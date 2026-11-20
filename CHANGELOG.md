# @hussmartinez/audio-sdk

## 0.9.0

### Minor Changes

- [`b5197e0`](https://github.com/ie-huss-martinez/audio-sdk/commit/b5197e0baf34fe0a872207794c034209985893bb) Thanks [@hussmartinez](https://github.com/hussmartinez)! - **Breaking, for TypeScript only:** the types `AudioEditorMessageCatalogue`, `AudioEditorMessages` and `AudioEditorMessageOverrides` are now exported from the main entry, `@hussmartinez/audio-sdk`, and no longer from `@hussmartinez/audio-sdk/react`. Nothing changes at run time, and `audioEditorMessages` itself stays in `@hussmartinez/audio-sdk/react`. Change your imports:
  
  ```ts
  // Before
  import type { AudioEditorMessageOverrides } from "@hussmartinez/audio-sdk/react";
  // After
  import type { AudioEditorMessageOverrides } from "@hussmartinez/audio-sdk";
  ```
  
  They moved because the React editor and the `<hm-audio-editor>` element both use them, and the family keeps types shared by several entry points in the main one.
  
  `AudioEditorElementMethods`, the element's methods, is now an interface of its own instead of a `Pick` of `AudioEditorHandle`, with the same eight methods and signatures, and the element's `headingLevel` property is typed `2 | 3 | 4 | 5 | 6`, as `AudioHeadingLevel` is.

## 0.8.0

### Minor Changes

- [#107](https://github.com/ie-huss-martinez/audio-sdk/pull/107) [`59fb1f2`](https://github.com/ie-huss-martinez/audio-sdk/commit/59fb1f200c5fcf1fbbbe9f703ac01cfab856941f) Thanks [@hussmartinez](https://github.com/hussmartinez)! - A new usage event, `recording_downloaded`, comes through `onEvent` (and the element's `hm-audio-editor-event`) each time the export dialog's Download button asks the browser to download the file. It carries the same facts as `recording_exported`, the rounded length, sample rate, channels and sample format, and nothing about the file's name or contents.
  
  `recording_exported` still comes when the file is ready, before anyone asks to download it, so `recording_downloaded` is the later signal for a guard against leaving with unsaved work. It isn't a confirmed save, though, nor proof that a download is underway: a page can't learn whether the browser downloaded the file, or whether the person saved it or cancelled. The file also holds the plan as its export started, so keep your guard for any change your own code made to the plan during the export. If you need a confirmed save, pass `onExport`, save the `Blob` yourself, and clear your guard when that succeeds; `recording_downloaded` never comes then.
  
  `AudioSessionEvent`'s type union gains the new type, so a `switch` over `event.type` that checks for exhaustiveness needs a case for it.

## 0.7.6

### Patch Changes

- [#105](https://github.com/ie-huss-martinez/audio-sdk/pull/105) [`2f987fb`](https://github.com/ie-huss-martinez/audio-sdk/commit/2f987fb67ba6b9d6e10d8f1c77776c96cd5890dd) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `<hm-audio-editor>`'s `open()`, `insert()`, `export()` and `play()` no longer wait forever when the element is removed before its editor has rendered. They now reject with an `AudioError` whose code is `ABORTED` and whose `details.reason` is `"removed"`. Before, a call made right after connecting the element and followed by its removal, such as on a quick route change, never settled.

## 0.7.5

### Patch Changes

- [#102](https://github.com/ie-huss-martinez/audio-sdk/pull/102) [`57f22f4`](https://github.com/ie-huss-martinez/audio-sdk/commit/57f22f42429eec589faec5e9b3b5ed9ee3cc1c6a) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The editor now depends on `@hussmartinez/ui` ^0.15.0. Its gain sliders, on each track and in the inspector, take Escape during a drag or while a key is held: the gain goes back to where the gesture started and nothing changes in the recording or its undo history. Escape with no gesture in progress still does what it did, such as clearing the selection. Nothing changes in the API.

## 0.7.4

### Patch Changes

- [#95](https://github.com/ie-huss-martinez/audio-sdk/pull/95) [`69fc7cd`](https://github.com/ie-huss-martinez/audio-sdk/commit/69fc7cd5c34d6c4adc8eef080af8c323cf2baeb6) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The editor now depends on `@hussmartinez/ui` ^0.14.2, whose announcer says messages raised in the same frame together. A file warning and "Recording opened." are still both announced when a recording opens, now by `ui` instead of the editor's own workaround. Nothing changes in the API.

- [#97](https://github.com/ie-huss-martinez/audio-sdk/pull/97) [`67841b2`](https://github.com/ie-huss-martinez/audio-sdk/commit/67841b23ac9a7bd9795744366e9d77e23918f029) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The editor now depends on `@hussmartinez/ui` ^0.14.3, which marks the icons that point along time (undo and redo, move earlier and later, trim, fade, range and skip) to mirror in right-to-left text. Nothing changes in left-to-right text or in the API.

- [#98](https://github.com/ie-huss-martinez/audio-sdk/pull/98) [`b08aa18`](https://github.com/ie-huss-martinez/audio-sdk/commit/b08aa188f1e83f1e042054f1cfe8e18a484a2a03) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The editor now depends on `@hussmartinez/ui` ^0.14.4. In right-to-left text, the icons that point along time now mirror (undo and redo, move earlier and later, trim, fade, range and back to the start), also when your build tool rewrites `:dir(rtl)` for older browsers. Nothing changes in left-to-right text or in the API.

## 0.7.3

### Patch Changes

- [#93](https://github.com/ie-huss-martinez/audio-sdk/pull/93) [`bb82a78`](https://github.com/ie-huss-martinez/audio-sdk/commit/bb82a78b456424b84c936428e0e649300565eb65) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The editor now depends on `@hussmartinez/ui` ^0.14.1. Keyboard users see the whole focus ring around the timeline's playhead and around the text field in the rename dialog; before, part of each ring was cut off. To make room for the playhead's ring, the timeline's ruler row is a few pixels taller and its lanes are a few pixels narrower at each end. Nothing changes in the API.

## 0.7.2

### Patch Changes

- [#90](https://github.com/ie-huss-martinez/audio-sdk/pull/90) [`9ba9ab6`](https://github.com/ie-huss-martinez/audio-sdk/commit/9ba9ab662e36e9ecc14ea9c2f1250a4f97517e9a) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The editor's notices show one notice per kind of warning, with that kind's different sentences, so two recordings that raise the same warning no longer show the same sentence twice, and Dismiss hides that kind. Each kind is announced once, politely, as it first appears, such as a long or truncated recording after it's added, so a screen-reader user hears it as well as sees it; undo and redo never announce it again. Messages said at the same moment, such as "Recording added." and its warning, are now said together, so neither replaces the other.

## 0.7.1

### Patch Changes

- [#87](https://github.com/ie-huss-martinez/audio-sdk/pull/87) [`e18c514`](https://github.com/ie-huss-martinez/audio-sdk/commit/e18c5145c495c0762baf6776d04f21c99b41d902) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The README documents the React editor and the `<hm-audio-editor>` element: their props, attributes, methods and events, the export dialog, every tool and shortcut, the building blocks, server rendering in Next.js, and what a strict Content Security Policy needs. It no longer says they come later.

## 0.7.0

### Minor Changes

- [#72](https://github.com/ie-huss-martinez/audio-sdk/pull/72) [`1c63a0f`](https://github.com/ie-huss-martinez/audio-sdk/commit/1c63a0f22ce9fe6250f3b8a94a5abf587dd8ba81) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The editor's clip tools, in a new Clip group of the toolbar:
  
  - **Split** at the playhead, with `S`. Focus moves to the part after the playhead.
  - **Delete** the selected clip, with Delete or Backspace. Its track stays, with silence where the clip was.
  - **Trim start** and **Trim end** set the clip's edge to the playhead, with `[` and `]`. On a clip, Alt+`[` and Alt+`]` shorten an edge by 10 ms, and with Shift they lengthen it. Dragging an edge trims too.
  - **Move earlier** and **Move later** nudge the clip by 10 ms, as Alt+← and Alt+→ do on a clip. **Move to the track above** and **below** keep its time, as Alt+↑ and Alt+↓ do. A clip also moves by dragging its title strip, along time or to another track.
  
  A move or trim that would overlap another clip, or reach past the start or the recording, is refused and announced. Nothing is pushed aside.

- [#82](https://github.com/ie-huss-martinez/audio-sdk/pull/82) [`1dfa331`](https://github.com/ie-huss-martinez/audio-sdk/commit/1dfa331a3f423a2cb386c12d301488239dc624b6) Thanks [@hussmartinez](https://github.com/hussmartinez)! - **`<hm-audio-editor>`**, the editor as a custom element, from `@hussmartinez/audio-sdk/element`. Importing the entry registers nothing: call `defineAudioEditorElement()`, once, for the tag or one you name. It renders `AudioEditor` into the element's light DOM, so React and React DOM are needed, and you load `@hussmartinez/ui/styles.css` and then this package's `styles.css`.
  
  - **Attributes:** `theme` (`light`, `dark` or `system`), `locale`, and `tools`, space-separated.
  - **Properties:** `file`, which opens a recording when you set it, `fileName`, `headingLevel`, `filePolicy`, `assetsUrl`, `messages`, `engine`, `processor` and `output`.
  - **Methods:** `open`, `insert`, `export`, `undo`, `redo`, `play`, `pause` and `seek`.
  - **Events:** `hm-audio-editor-change` with the plan, `hm-audio-editor-event` with the usage event, `hm-audio-editor-export` with an `AudioExportReport` after the export dialog finishes (format, size, peak and clamped frames, no file), and `hm-audio-editor-error` with a failure's `code` and `details`. None carries a file name or contents.

- [#81](https://github.com/ie-huss-martinez/audio-sdk/pull/81) [`922312a`](https://github.com/ie-huss-martinez/audio-sdk/commit/922312a2e1200d4dd818253186edadd897975899) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The editor exports, through **`AudioExportDialog`**, which the toolbar's new Export button opens:
  
  - **A summary first:** the length, sample rate and channels, any track a mute or a solo leaves out, and the metadata that will be written. Then the format, 16-bit (the default), 24-bit or 32-bit float WAV, each with the file's exact size.
  - **While it runs,** a progress bar and Stop. **When it's done,** Download, which saves `<fileName>.wav`. The name comes from the new `fileName` prop, or else the recording's title, or else `recording`.
  - **When the mix clipped,** the dialog says by how much, and one button lowers the master gain by that and exports again.
  - **`onExport(blob, result)`** on `AudioEditor` and `AudioExportDialog` takes the file instead of the download, and the dialog closes. `result` has the mix's `peakDb` and its `clippedFrames`.
  - **The editor's handle** gains `export(options)`, which exports without the dialog.

- [#77](https://github.com/ie-huss-martinez/audio-sdk/pull/77) [`18762bc`](https://github.com/ie-huss-martinez/audio-sdk/commit/18762bcb74b643c873d704a21b64f0f8a779f407) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The editor has an inspector, `AudioInspector`, after the transport:
  
  - **With a clip selected:** its Start, as a timecode such as `0:04.20` (plain seconds work too), its gain, and each fade's length in seconds with its curve, Linear or Equal power. A start that would overlap another clip is refused and announced.
  - **Otherwise:** the recording's length, sample rate and tracks, its master gain, its channels, and its metadata: title, artist, album, year and comment.
  
  Fields apply when you press Enter or leave them, and sliders when you let go, each as one undo step. Where the editor is at least 1080 px wide, the inspector sits beside the timeline; otherwise it's below the transport. `classNames` gains an `inspector` part.

- [#80](https://github.com/ie-huss-martinez/audio-sdk/pull/80) [`01fec9f`](https://github.com/ie-huss-martinez/audio-sdk/commit/01fec9ff42c7907713e652d25658b79b29cdc8ed) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The editor edits what a range covers, and fades clips from the toolbar:
  
  - **Fade in** and **Fade out** join the toolbar's Clip group. With a range selected, the range's clips are split at its edges, then Fade in fades each track's first piece inside the range in, over that piece, and Fade out fades its last piece out, as one undo step. A fade belongs to a clip, so where the range spans several clips, only the first or last one fades. With a clip selected and no range, the clip gets a half-second fade, which the inspector then sets exactly.
  - **The inspector's Selection section**, shown while a range is selected, sets the gain of everything in the range, splitting its clips at its edges, as one undo step.
  - **`headingLevel`** on `AudioEditor` and `AudioInspector`, from 2 to 6, sets the level of the inspector's heading, which is now a heading rather than a paragraph, so it fits your page's outline. It defaults to 2. The new `AudioHeadingLevel` type names the levels.

- [#74](https://github.com/ie-huss-martinez/audio-sdk/pull/74) [`1d4b9c6`](https://github.com/ie-huss-martinez/audio-sdk/commit/1d4b9c6e454f82c2a8717f9e5f5f5a4248df77c3) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The editor selects ranges of time, and deletes them:
  
  - **Select by dragging** across the timeline. The range covers the tracks the drag crosses, and snaps unless you hold Alt. A click without a drag moves the playhead and clears the selection.
  - **Select with the keyboard:** `I` and `O` set the selection's start and end at the playhead, and Shift with the playhead's arrow, Page and Home/End keys extends it. Escape clears it. The toolbar's new Selection group has a button for each.
  - **Delete** deletes the selected range before a selected clip, and puts the playhead and focus at the range's start.
  - **Ripple**, a toggle in the Selection group, is on by default. With it on, deleting a range closes the gap on the range's tracks; with it off, silence stays. When the range covers only some tracks, their lanes and headers show that their later clips will move.
  - The transport shows the selection as text, such as "Selected 0:04.00 to 0:09.20 on every track".

- [#67](https://github.com/ie-huss-martinez/audio-sdk/pull/67) [`124ee96`](https://github.com/ie-huss-martinez/audio-sdk/commit/124ee96c2635a497776fadefae42a65664ff214c) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The React editor's first parts, in `@hussmartinez/audio-sdk/react`:
  
  - **`<AudioEditor>`** with the empty state (a drop zone with a button to choose a file), an open or insert in progress with Cancel, a failed one by its error's text, the session's warnings in one dismissible notice, and the transport: play and pause, back to the start, and the time as `0:12.40 / 1:05.00`. Its props are the provider's, and `initialFile`, `onChange`, `theme`, `className`, `classNames` and `unstyled`. Its ref has `open`, `insert`, `undo`, `redo`, `play`, `pause` and `seek`.
  - **`AudioEditorProvider`**, which makes the SDK's engine, processor and output for any you don't pass, and releases only those; ones you pass stay yours.
  - **Hooks:** `useAudioSession`, `useAudioOutput`, `useAudioPlayhead` and `useAudioMessages`.
  - **Building blocks:** `AudioStage`, `AudioNotices` and `AudioTransport`.
  - **`audioEditorMessages`,** the editor's catalogue, with `ui`'s, for the `messages` prop's overrides.
  
  `@hussmartinez/ui` 0.12 is now a dependency. Load its stylesheet before this package's:
  
  ```ts
  import "@hussmartinez/ui/styles.css";
  import "@hussmartinez/audio-sdk/styles.css";
  ```
  
  The timeline, the tools, the inspector and the export dialog follow before 0.7.0.

- [#70](https://github.com/ie-huss-martinez/audio-sdk/pull/70) [`d6e33a5`](https://github.com/ie-huss-martinez/audio-sdk/commit/d6e33a58ca4eb017d5064a8b20aa8416dee575e5) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The editor's timeline, `AudioTimeline`, on `ui`'s `Timeline`: a lane for each track, with its name, its waveform drawn from the recording's overview and its clips where they sit in time, the playhead as a slider over all of them (10 ms with the arrow keys, a second with Page Up and Page Down), and zoom with Zoom in, Zoom out and Fit to width. `AudioEditor` shows it once a recording is open, and puts focus on the playhead after opening. `classNames` gains a `timeline` part.

- [#71](https://github.com/ie-huss-martinez/audio-sdk/pull/71) [`f5e976c`](https://github.com/ie-huss-martinez/audio-sdk/commit/f5e976c8f7dd05b3c4282a4818f2310c601c2304) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The editor's tracks and tools:
  
  - **`AudioToolbar`**, at the top of `AudioEditor`: Open and Add recording, Undo and Redo, Add, Remove and Move track up or down, and the zoom buttons. The `tools` and `toolbar` props choose the tools and their groups by id, such as `tools={["audio.undo", "audio.redo"]}`.
  - **Each track's header:** its name, which opens a dialog to rename it, Mute, Solo, and its gain. A gain drag is one undo step.
  - **Keys** while focus is in the editor: Ctrl+Z and Ctrl+Shift+Z (⌘ on Apple) to undo and redo, `+`, `-` and `0` to zoom, `M` to mute the current track, Space to play and pause, and Home and End to go to the start and the end.
  - `classNames` gains a `toolbar` part.
  
  `@hussmartinez/sdk-core` is now `^0.4.4`.

### Patch Changes

- [#78](https://github.com/ie-huss-martinez/audio-sdk/pull/78) [`41d5413`](https://github.com/ie-huss-martinez/audio-sdk/commit/41d54139a84ece5942f465edd7d44f1432b158a5) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `@hussmartinez/ui` is now `^0.14.0`. Nothing changes in how the editor behaves: a gain slider's change, in a track's header or in the inspector, is still one undo step a gesture, now through `ui`'s `onValueCommit`, and selecting the clip that takes focus is now `ui`'s work rather than the editor's.

- [#84](https://github.com/ie-huss-martinez/audio-sdk/pull/84) [`a2912b1`](https://github.com/ie-huss-martinez/audio-sdk/commit/a2912b1fe98e3d29288e78755f2f03ee7624185a) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The timeline shows each track's waveform and the selected range again: a clip's opaque background covered both. Clips are now see-through, marked by their outline, which is wider and in the accent colour when selected, and each clip's title keeps a solid background so it stays legible over the waveform. The inspector's gain sliders now have a visible label, not only an accessible name.

## 0.6.0

### Minor Changes

- [#60](https://github.com/ie-huss-martinez/audio-sdk/pull/60) [`5844aed`](https://github.com/ie-huss-martinez/audio-sdk/commit/5844aed5b7e291446c8fc26d82621578e1221dfd) Thanks [@hussmartinez](https://github.com/hussmartinez)! - **Multitrack.** The plan is now a list of tracks, each with a name, a gain, mute and solo, and clips placed in time. Tracks play together, and `export()` mixes them. This changes the plan's shape, most commands and what `export()` returns.
  
  **The plan**
  
  - `plan.clips` is gone: clips are in `plan.tracks[i].clips`, and each has `at`, the timeline frame it starts on. A track's clips are in time order and never overlap. `plan.gainDb` is the master gain.
  - `planLength(plan)` is where the last clip on any track ends. `clipOffsets` is removed: read `clip.at`. New: `audibleTracks`, `mixLength`, `clipEnd`, `trackLength` and `clipAt`.
  - `session.open()` makes one track with one clip, so a single recording reads as `plan.tracks[0].clips[0]`.
  
  **Commands**
  
  - Clip edits no longer move other clips. `audio.insertClips { track, clips }` needs free space, `audio.removeClips` leaves silence, and `audio.trimClip` keeps the audio where it is on the timeline. Each fails with `clips-overlap` rather than push a neighbour.
  - Closing a gap is asked for: `audio.deleteRange { start, end, tracks, ripple, newKeys? }`. To get the old `audio.deleteRange { start, end, newKey }`, name every track, set `ripple: true`, and pass `newKeys: { [trackKey]: session.createKey() }`.
  - `audio.moveClips` is now `{ keys, by, track? }`: a move in time, and to another track. `audio.reorderClips` is removed.
  - New: `audio.keepRange`, `audio.insertTime`, `audio.addTrack`, `audio.removeTracks`, `audio.moveTrack`, `audio.setTrack`, `audio.setMasterGain` and `audio.setChannels`.
  - `migrateAudioCommand(command, plan)` turns a stored version 1 command into the version 2 commands with the same effect.
  
  **The session**
  
  - **`session.insert()` no longer appends.** It adds the recording on a new track of its own, starting at `at`, which defaults to 0, so it plays together with what's there. To append as before, name the track and its end: `session.insert(file, { track: track.key, at: trackLength(track) })`, with `track` being `plan.tracks[0]`. A recording with more channels than the plan widens the plan.
  - `snapshot.selection` is `{ start, end, tracks }`, and `session.select()` takes optional `tracks`.
  - `session.export()` resolves `{ blob, peakDb, clippedFrames }` instead of a `Blob`: use `.blob`. A mix of tracks can go over full scale; it's clamped, and `peakDb` and `clippedFrames` say how far and how often. An export with every track silent is refused with the reason `nothing-audible`.
  - An export ends where the last audible clip ends. Silence after it isn't exported, and a muted track doesn't lengthen the file: for a pause at the end, put a clip there.
  
  **Documents**
  
  - `toAudioPlanDocument` writes `hm-audio-plan` version 2, and `readAudioPlanDocument` reads versions 1 and 2, returning a multitrack plan: a version 1 document becomes one track. The version 2 schemas ship in `formats/`.
  
  **If you pass your own `processor`,** `render()` must mix the plan's audible tracks, with track and master gains, and resolve `{ blob, peakDb, clippedFrames }`. An `output` gets the plan with tracks in `load()`.

- [#66](https://github.com/ie-huss-martinez/audio-sdk/pull/66) [`2e9399a`](https://github.com/ie-huss-martinez/audio-sdk/commit/2e9399a0e5be7a8f9904a296f19ffe46623024c5) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Helpers for building playback and text on the session.
  
  - **`watchPlayhead(output, listener)`** follows the playhead without a framework: it calls you with the frame now, on animation frames while playing, and whenever the playhead jumps. Returns a function that stops it.
  - **The output notifies subscribers when the playhead jumps,** after a seek, a stop or a plan that moves it, with a new snapshot in the same state. Before, a seek while paused told nobody. `position()` is a whole number of frames. **If you pass your own `output`,** it must do the same.
  - **`formatTimecode(frames, sampleRate)`** gives `0:12.40`, or `1:02:05.00` from an hour on, rounded down to hundredths.
  - **`peakColumns(peaks, { from, to, columns })`** gives each column of a waveform its lowest and highest sample, from the overview level that fits the zoom.
  - **`audioErrorText(messages, error)`** gives an error's text by its code and its `details.reason` together, falling back to `messages.error()`. A blocked `play()` now has `details.reason: "autoplay-blocked"` and says that sound needs a press of Play, rather than that the browser lacks a feature. An edit that would make the plan too long has `details.reason: "plan-too-long"`, with its own text.
  - **`audioWarningText(messages, warning)`** gives any of the snapshot's warnings its text.
  
  The catalogue gains `errors.UNSUPPORTED_ENVIRONMENT.autoplay-blocked` and `errors.DURATION_TOO_LONG.plan-too-long`. If you supply your own catalogue, add them.

- [#56](https://github.com/ie-huss-martinez/audio-sdk/pull/56) [`18ba106`](https://github.com/ie-huss-martinez/audio-sdk/commit/18ba1063d030ea85922525c839b98ec5b1e4658d) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Insert recordings at any sample rate. `session.insert()` used to refuse a file whose rate differed from the session's with `UNSUPPORTED_FORMAT`; it now converts it to the session's rate, in the worker, with progress and cancellation. The converted source reports the file's own rate as `resampledFrom` in `snapshot.sources`.
  
  `AudioEngine.decode()` takes a new option, `sampleRate`, the rate to return the audio at. The SDK's engine converts with its own windowed-sinc resampler, so every browser gives the same samples. **If you pass your own `engine`,** it must honour `sampleRate` too: the session refuses audio at any other rate with `INVALID_AUDIO`.

- [#65](https://github.com/ie-huss-martinez/audio-sdk/pull/65) [`92237c5`](https://github.com/ie-huss-martinez/audio-sdk/commit/92237c5d41bb8bf33cdc8af9ea76b74d12c7d4bd) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Make the session easier to build a UI on.
  
  - **`createAudioAdapters({ assetsUrl })`** makes the engine, the processor and the output with one set of options, so a self-hosted worker's address is given once. Its `destroy()` releases all three. You still own them: the session never destroys what it's given, as before.
  - **Recordings have names:** `open()` and `insert()` take an optional `name`, and use a `File`'s own name without one. It's on each entry of `snapshot.sources`, as `name`, cleaned as pdf-sdk cleans file names: the last path segment, without control, bidirectional formatting or Windows-refused characters (`< > : " | ? *`), in NFC, without leading dots or surrounding space, and at most 128 code points (`MAX_SOURCE_NAME_LENGTH`). It never goes into events, the plan or a document.
  - **The session gives commands the keys they leave out:** `newKey` in `audio.splitClip`, `key` in `audio.addTrack`, and the `newKeys` of `audio.deleteRange` and `audio.insertTime`. You no longer need `session.createKey()` for those, though passing your own still works.
  - **A command that changes nothing succeeds without an undo step,** such as setting a gain that's already set. Before, some were refused.
  - **The selection follows defined rules:** a time edit (`audio.deleteRange`, `audio.keepRange`, `audio.insertTime`) clears it; other edits, undo and redo keep it, clamped to the plan.
  - **The session's and the output's methods work on their own,** so `useSyncExternalStore(session.subscribe, session.getSnapshot)` works as written.
  
  If you relied on a time edit shrinking the selection, select again after it.

- [#63](https://github.com/ie-huss-martinez/audio-sdk/pull/63) [`87eb53b`](https://github.com/ie-huss-martinez/audio-sdk/commit/87eb53bd5f73eec998ddc5e86bee7f2c11d9ea49) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Limit the number of tracks and the plan's length. A new limit, `maxTracks`, defaults to 16: a command or an insert that would add a track past it throws `TOO_MANY_TRACKS`, a new error code, with text in `audioMessages`. And `maxDuration`, 3 hours by default, now bounds the plan's length as well as each file's: an edit or an insert that would make the plan longer throws `DURATION_TOO_LONG`. Clips can be placed anywhere on the timeline, so without it one command could ask for hours of silence.
  
  Both leave the plan as it was, and both are changed through `filePolicy`, such as `{ maxTracks: 32 }`. `maxClips` counts the clips of every track together.
  
  If you handle error codes exhaustively, add `TOO_MANY_TRACKS`. If you supply your own message catalogue, add `errors.TOO_MANY_TRACKS` and `warnings.maxTracks`.

### Patch Changes

- [#62](https://github.com/ie-huss-martinez/audio-sdk/pull/62) [`5255606`](https://github.com/ie-huss-martinez/audio-sdk/commit/52556068211668b2a459d067c77120557877db8c) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Muting, soloing and changing a track's gain or the master gain during playback now take effect at once, without a gap. `createAudioOutput()` used to stop and reschedule every clip on any change of the plan; a plan that differs only in those levels is now applied to what's playing, over 5 ms. Other edits still reschedule from the playhead. Nothing changes in the API.

## 0.5.0

### Minor Changes

- [#50](https://github.com/ie-huss-martinez/audio-sdk/pull/50) [`809bdb4`](https://github.com/ie-huss-martinez/audio-sdk/commit/809bdb4aa4abda2a2baae7c3b8abdc848a278567) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Adds `connectOutput(session, output)`, which keeps an `AudioOutput`, such as `createAudioOutput()`, playing what the session holds. Edits, undo and inserts reach playback at once, carrying on from the playhead, and closing or replacing the recording stops it at the start. It returns a function that disconnects them. `session.getAudio(id)` gives a source's decoded audio, for playback.

## 0.4.0

### Minor Changes

- [#46](https://github.com/ie-huss-martinez/audio-sdk/pull/46) [`7867817`](https://github.com/ie-huss-martinez/audio-sdk/commit/7867817b9b6740b4d7fb757ade2048c2e83e1716) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Adds `createAudioOutput()`, the SDK's `AudioOutput`: it plays a plan through Web Audio, from the playhead, and reschedules from the playhead whenever the plan changes or it seeks, so an edit or a seek during playback always takes effect.
  
  - **Rendering:** each clip plays its source through a gain that follows `gainAt`, so playback matches export, gains and fades included. Sources with other channel counts mix into the plan's by Web Audio's speaker rules, as export mixes them.
  - **The playhead:** `position()` reads it from the audio clock, for a view to poll on animation frames. When playback reaches the end, the state becomes `stopped`.
  - **Starting audio:** the first `play()` should come from a click or a key press, as browsers require. If audio output doesn't start within two seconds, `play()` rejects with `UNSUPPORTED_ENVIRONMENT`, and the output stays as it was.

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
