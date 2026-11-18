# 0005. The editor shell: layout, the waveform timeline, selection, shortcuts and focus

- **Status:** Accepted; superseded in part by [0006](0006-multitrack.md): the timeline, the selection and the order of the work
- **Date:** 2026-11-15

## Context

The headless core is built: opening and decoding ([ADR 0001](0001-audio-engines.md)), the session and its commands ([ADR 0003](0003-clip-plan-document-model.md)), export, playback through Web Audio, and `connectOutput`, which keeps playback in step with the session ([ADR 0002](0002-workers-and-assets.md)). The React entry and the custom element come next. The family fixes most of their shape:

- **Four layers:** the full editor, building blocks, hooks, and the headless core (STANDARDS, "React API"). Every editor takes the same configuration props, and a ref handle for programmatic control.
- **`ui` provides the controls:** Toolbar, Button, ToggleButton, Slider, NumberField, TextField, Field, SegmentedControl, Dialog, FileDropZone, ProgressBar, Tooltip, Announcer and the icon set ([sdk-core ADR 0036](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0036-ui-as-a-dependency-of-the-sdks.md)), each to its component contract ([ui ADR 0003](https://github.com/ie-huss-martinez/ui/blob/main/docs/adr/0003-component-contract.md)). It has no timeline yet.
- **Tools and shortcuts** go through `sdk-core`'s `defineTool`, `createToolRegistry` and `createShortcutRegistry`, with the family's shortcuts, scoped to the editor's root ([sdk-core ADR 0009](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0009-features-as-tools.md), [ADR 0030](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0030-tools-and-keyboard-shortcuts.md)). Timeline arithmetic is `sdk-core`'s `sequenceOffsets`, `locate` and `snap` ([ADR 0042](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0042-timeline-sequence-helpers.md)).
- **The element** is `sdk-core`'s `createEditorElement`, rendering the React editor into the light DOM ([sdk-core ADR 0040](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0040-editor-element-base.md)).
- **WCAG 2.2 AA:** full keyboard support with an alternative to every drag, visible focus, native dialogs, `aria-live` results, and targets of at least 24 px (44 px on touch). No inline text.
- **video-sdk's editor shell** ([video-sdk ADR 0007](https://github.com/ie-huss-martinez/video-sdk/blob/main/docs/adr/0007-editor-shell.md)) built a clip timeline as its own building block, and named audio-sdk's editor needing a clip track as the trigger for moving it to `ui`, by the family's rule of two consumers.

What's left to this SDK: the layout of an audio editor, the waveform, selecting a range of time rather than whole clips, the keyboard model for both, and where focus goes after each action. An audio editor differs from a video editor in one way that shapes everything else: people edit **ranges of time**, found by listening and by looking at the waveform, more often than whole clips.

## Decision

### Layout

`<AudioEditor>` renders one root, `.hm-audio-editor`, with these regions in order, which is also the tab order:

1. **Toolbar** (`ui` Toolbar): open and insert, undo and redo, split, delete, fades, and export, built from the tool registry.
2. **Timeline:** the waveform of the plan, with the clips' boundaries, the selected range and the playhead. It's the stage: an audio editor has no picture to preview.
3. **Transport:** play and pause, back to the start, and the time as `0:12.40 / 1:05.00`, with hundredths of a second.
4. **Inspector:** the focused clip's gain, as a `ui` Slider and NumberField in dB, and its fade in and fade out, each a length and a curve. With no clip focused, the recording's sample rate and channels, and the metadata fields.

Below a container width of 720 px, the inspector moves under the transport. Sizes come from a container query on the root, not the viewport.

**Designed states** (STANDARDS, "UX"):

- **Empty:** `ui`'s FileDropZone fills the timeline, with a button to choose a file, so dropping is never the only way.
- **Opening and inserting:** a ProgressBar from the call's `onProgress`, with a Cancel button, which aborts the call.
- **Error:** the catalogue's text for the code, where the action was, with the next step. A failed open keeps the recording that was open ([ADR 0003](0003-clip-plan-document-model.md)).
- **Warnings:** the snapshot's warnings as one notice above the timeline, with each warning's catalogue text: a long recording, a truncated file, or a large session. Each can be dismissed, and doesn't come back for the same source.
- **Audio blocked:** when `play()` rejects with `UNSUPPORTED_ENVIRONMENT` ([ADR 0002](0002-workers-and-assets.md)), a notice by the transport says sound needs a click on Play.
- **History trimmed:** when the snapshot's `historyTrimmed` turns true, a polite announcement and a line in the notice say that the earliest edits can't be undone ([ADR 0004](0004-audio-limits.md)).

### The waveform

- **It's drawn on a canvas from the peaks, never from the samples** ([ADR 0002](0002-workers-and-assets.md)). For each clip, the drawing takes the finest level of the source's peak pyramid whose bucket is at least one device pixel wide at the current zoom, and draws each column's minimum and maximum. So drawing costs the same for an hour as for a minute.
- **One canvas, owned by React,** sized by a ResizeObserver to the timeline's width and `devicePixelRatio`, and redrawn on the next animation frame after the plan, the zoom, the scroll, the size or the theme changes. It's never redrawn while the playhead moves: the playhead and the selection are separate elements over it.
- **Colours come from `ui`'s tokens,** read from the root's computed style, so themes and forced colours apply. In forced colours, the waveform uses `CanvasText`.
- **The canvas is `aria-hidden`.** Everything it shows has a text equivalent: the clips' names, the selection's range and the playhead's time.
- **Clips are shown as they play:** each clip's part of its source, scaled by its gain, with its fades drawn as the envelope's outline from `gainAt`. So what's seen is what's heard and exported.

### The timeline component

**The clip track moves to `ui`, as video-sdk ADR 0007 planned.** audio-sdk's editor is the second consumer, which is the trigger it named. The move is `ui`'s own work, with an ADR there: a `Timeline` with the track of clips as a listbox, the playhead slider, snapping and zoom, to the component contract. Both SDKs then render `ui`'s. What stays in each SDK is what its media needs: here, the waveform canvas and the range selection, as layers that `ui`'s `Timeline` hosts.

Until `ui` ships it, this SDK's step 2 builds `AudioTimeline` to the same design and contract, under `hm.sdk`, so the switch to `ui`'s replaces a component without changing behaviour. The work order below doesn't wait for `ui`.

The design, in output frames, with `sdk-core`'s helpers:

- **Layout:** `sequenceOffsets` of the clips' lengths gives every boundary, for drawing the clips, the playhead and the selection.
- **Hit testing:** `locate` maps a pointer's frame to the clip under it and the frame within it. A frame on a boundary belongs to the clip that starts there.
- **Snapping:** the playhead, a selection's edges and a trim snap with `snap` to the clips' boundaries and the playhead, within 8 CSS pixels at the current zoom: `Math.round(8 × framesPerPixel)`. `Alt` while dragging turns it off.
- **The track is a `listbox`** of clips, horizontal, with roving focus: one tab stop, Left and Right between clips, Home and End to the first and last, and the selection of clips follows focus. Each clip's accessible name is its position and its range: "Clip 2 of 5, 0:04.00 to 0:09.20, −3 dB". In a right-to-left layout, Left and Right swap.
- **The playhead is a `ui` Slider** over frames, with `aria-valuetext` the time, so a screen reader reads "0:12.40". Its arrow keys step 10 milliseconds, Page Up and Page Down one second, and Home and End go to the start and end.
- **Zoom** is the family's `+`, `-` and `0`, without a modifier, and `0` fits the plan to the timeline. Scrolling follows the playhead while playing.

### Selecting a range

The session's selection is a range of the timeline in frames ([ADR 0003](0003-clip-plan-document-model.md)), which the delete, fade and gain tools act on.

- **With a pointer,** dragging across the waveform selects the range under it, snapping as above. A click without a drag moves the playhead, and clears the selection.
- **With the keyboard,** on the playhead slider: `I` sets the selection's start at the playhead and `O` its end, as in other audio and video editors; `Shift` with the slider's arrow keys extends the selection from the playhead by the slider's step; and `Escape` clears it.
- **A single-pointer alternative** to the drag (WCAG 2.5.7): the toolbar's Set start and Set end buttons do what `I` and `O` do.
- **The selection's range is announced** politely when it changes by keyboard, as "Selected 0:04.00 to 0:09.20", and shown as text in the transport.
- **Editing a range,** with `sdk-core`'s commands:

  | Action | With a selected range | With a focused clip and no range |
  |---|---|---|
  | Delete | `audio.deleteRange` of the range | `audio.removeClips` of the selected clips |
  | Split | at the playhead | at the playhead |
  | Fade in, fade out | split at the range's edges, then set the fade over it | set the clip's fade to the inspector's length |
  | Gain | split at the range's edges, then set the gain of what's between | set the selected clips' gain |

  An action that splits and then changes is one undo step, through `session.group()`.

### Trimming

- **Dragging a clip's edge** on the track trims it, snapping as above, and is one undo step when it ends.
- **Keys, on a focused clip:** `[` and `]` set its start or end to the playhead. `Alt+[` and `Alt+]` move the edge 10 ms inward, and `Alt+Shift+[` and `Alt+Shift+]` 10 ms outward. The brackets are matched by position, `event.code`, not by character, as in video-sdk: `Alt` changes the character on Apple's layouts.
- **A single-pointer alternative:** the toolbar's Trim start and Trim end buttons, which set the focused clip's edge to the playhead.

### Tools and shortcuts

Each feature is a folder under `src/features/` with its command, UI, styles, messages and tests, registered with `defineTool`. The headless tool definitions live there and may name their icons with `ui`'s `IconName`; only `react/` and `element/` import `ui`'s React layer ([sdk-core ADR 0036](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0036-ui-as-a-dependency-of-the-sdks.md)).

| Tool | Keys | Notes |
|---|---|---|
| `audio.play-pause` | family `play-pause` (`Space`) | Not on fields or controls, so `Space` on a button presses it |
| `audio.start`, `audio.end` | `Home`, `End` | Not on controls, whose own keys they are |
| `audio.split` | `S` | At the playhead |
| `audio.delete` | family `delete` | The range, or else the selected clips |
| `audio.set-start`, `audio.set-end` | `I`, `O` | The selection's edges, at the playhead |
| `audio.clear-selection` | `Escape` | Only when there's a selection, and never in a dialog, whose `Escape` closes it |
| `audio.trim-start`, `audio.trim-end` | `[`, `]` | The focused clip |
| `audio.fade-in`, `audio.fade-out` | none | Through the toolbar and the inspector |
| `audio.undo`, `audio.redo` | family `undo`, `redo` | |
| `audio.zoom-in`, `audio.zoom-out`, `audio.zoom-fit` | family zoom | |
| `audio.open`, `audio.insert` | none | `Mod+O` is the browser's own |
| `audio.export` | none | Through the export dialog |

**Single-key shortcuts,** `S`, `I`, `O`, `[`, `]`, `+`, `-` and `0`, and the unmodified `Home` and `End`, are active only while focus is inside the editor's root, which is WCAG 2.1.4's condition for character-key shortcuts. They never fire in a text field, `select` or `contenteditable`. Each tool's button carries `aria-keyshortcuts` from the registry, and its tooltip shows the keys from the catalogue, through `ui`'s Tooltip. The platform comes from `ui`'s `usePlatform()`. A tool that can't run stays in the toolbar's keyboard order with `aria-disabled`. Tools that a host leaves out with `tools` have no keys either.

### Focus

Focus always lands somewhere meaningful, and never on `<body>`:

- **After opening,** on the timeline's playhead slider. **After an insert,** on the new clip.
- **After a split,** on the part after the playhead.
- **After deleting a range,** on the playhead slider, at the range's start. **After deleting clips,** on the clip that took the first one's place, or else the one before, or else the slider.
- **After undo or redo,** on the clip the command changed, when there is one. Undo and redo are announced.
- **Dialogs** are `ui`'s native `<dialog>` with `showModal()`, which returns focus to the opener on close.
- **Announcements** go through `ui`'s Announcer, politely: opens, inserts and exports done or failed, undo and redo, selections made by keyboard, audio blocked, and history trimmed.

### The export dialog

`audio.export` opens it, with no shortcut.

- **The summary comes first,** as the standards require for irreversible outputs: the length, the sample rate and channels, the metadata that will be written, and the estimated size of each format.
- **The choice:** 16-bit WAV (the default), 24-bit WAV or 32-bit float WAV, as a `ui` SegmentedControl.
- **While it runs:** a ProgressBar from `onProgress`, and Stop, which aborts it.
- **When it's done:** Download, which gets focus, and Done. The download is a link to an object URL that's revoked when the dialog closes. A host's `onExport` takes the `Blob` instead, and the dialog closes.
- **Closing or unmounting** stops an export that's running, and a result that arrives after that is dropped.

### The React API

- **`<AudioEditor>`** takes the family's props. `initialFile` is opened on mount; `onChange` gets the plan after each committed command. Then `engine`, `processor` and `output`, which default to the SDK's own; `filePolicy`, `assetsUrl`, `tools`, `toolbar`, `theme`, `className`, `classNames`, `unstyled`, `messages` and `locale`, `onEvent`, and `onExport`.
- **The ref handle** has `open(file)`, `insert(file, options)`, `export(options)`, `undo()`, `redo()`, `play()`, `pause()` and `seek(frame)`.
- **Building blocks:** `AudioToolbar`, `AudioTimeline`, `AudioTransport`, `AudioInspector` and `AudioExportDialog`, each usable inside an `AudioEditorProvider`.
- **Hooks:** `useAudioSession`, `useAudioOutput`, and `useAudioPlayhead`, which reads `position()` on animation frames while playing and the stored playhead otherwise, so only the components that show the time re-render at most once a frame.
- **Lifecycle:** the provider creates the session, the output and `connectOutput` in an effect, and its cleanup disconnects them, destroys the output and closes the session. React's StrictMode mounts twice in development, and the second mount gets fresh ones, so there's never more than one `AudioContext`.
- **One `Messages` object** for the SDK's text and `ui`'s, from the host's locale and `messages`, goes to `UiMessagesProvider` ([sdk-core ADR 0046](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0046-ui-text-through-the-sdk.md)).
- **The entry starts with `"use client"`** and does nothing on import. On a server it renders the empty state's markup, with no engine, worker or `AudioContext` ([sdk-core ADR 0007](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0007-server-rendering-and-nextjs.md)).
- **`@hussmartinez/ui`** is a dependency at the current minor, with React and React DOM as optional peers. Hosts load `@hussmartinez/ui/styles.css` once, before this SDK's stylesheet, which the README says in its first example ([sdk-core ADR 0036](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0036-ui-as-a-dependency-of-the-sdks.md)).

### The element

`defineAudioEditorElement` is built with `createEditorElement`: the tag `hm-audio-editor`, the attributes `theme`, `locale` and `tools`, the properties `filePolicy`, `assetsUrl`, `messages`, `engine`, `processor` and `output`, the ref handle's methods, and the events `change`, `event`, `export` and `error`. It mounts `<AudioEditor>` into the light DOM ([sdk-core ADR 0040](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0040-editor-element-base.md)).

### Tests

- **axe** on every designed state, in all three engines.
- **Keyboard only, end to end:** open through the drop zone's button, move the playhead, select a range with `I` and `O`, delete it, split, trim with the bracket keys, set a fade, undo, play and pause, and export. Each step checks where focus is.
- **Shortcuts** don't fire in fields or on controls, and `Space` on a button presses it.
- **The waveform** draws from the peaks: a test counts the samples read while drawing, which must be zero.
- **StrictMode:** mounting, unmounting and mounting again leaves one session, one output and one `AudioContext`.
- **Server rendering:** the entry renders on a server, with no engine, worker or `AudioContext`.
- **Playback in the editor** follows ADR 0043 of sdk-core: tests that need real-time audio output skip where the browser has none.
- **The element:** attributes and properties reach the editor, a move keeps the session, and a removal tears it down.
- **Screenshots** of each designed state, in light and dark, on Chromium in the pinned image ([sdk-core ADR 0048](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0048-visual-regression-for-sdk-editors.md)), against the built example.

### Order of the work

1. The React editor: the provider and hooks, the timeline with the waveform and the playhead, and the transport, with `ui` 0.7.
2. The tools, the toolbar, shortcuts, range selection and trimming.
3. The export dialog.
4. The element.
5. `examples/vite` and `examples/next`, with their end-to-end tests ([sdk-core ADR 0039](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0039-test-applications-in-each-repository.md)). They merge before any release that ships the React layer.
6. The screenshot tests.

## Alternatives considered

- **Clips only, with no range selection,** as video-sdk's timeline has: editing a passage would mean splitting twice and deleting a clip, three steps for what audio editors do in one.
- **Drawing the waveform from the samples:** exact at every zoom, but a full redraw of an hour of audio reads 1.4 GB, on every scroll and zoom. The peaks are built once for that purpose.
- **SVG for the waveform:** accessible by structure, but thousands of path points per clip, re-laid out on every zoom, where one canvas costs the same at every length. Its content is given in text instead.
- **A separate `AudioTimeline` that never moves to `ui`:** two clip tracks in the family would drift in keyboard model and accessibility, which is what the rule of two consumers prevents.
- **Waiting for `ui`'s `Timeline` before building the editor:** it would block every step here on another repository's release. Building to the same contract makes the switch a replacement.

## Consequences

- **Every action has a keyboard path, a single-pointer path and a defined focus target,** which the end-to-end tests check step by step.
- **The clip track becomes `ui`'s,** shared with video-sdk, once `ui` ships it. Until then, `AudioTimeline` follows its design here, and the switch is a planned replacement.
- **The waveform costs the same at every length,** at the price of being as fine as the peaks' finest level when zoomed in close.
- **Range edits are composed from existing commands,** split then change, as one undo step, so the plan format doesn't change.
