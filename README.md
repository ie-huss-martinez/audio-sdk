# audio-sdk

A client-side audio SDK: layer recordings on tracks, trim, split, fade, adjust gain, play and export audio entirely in the browser. Audio never leaves the device. It offers a headless core, a React editor (`AudioEditor`) and a `<hm-audio-editor>` custom element.

This repository publishes **[`@hussmartinez/audio-sdk`](https://www.npmjs.com/package/@hussmartinez/audio-sdk)**. It follows the family standards in [`sdk-core`'s `STANDARDS.md`](https://github.com/ie-huss-martinez/sdk-core/blob/main/STANDARDS.md), and in particular the decisions on [hostile input and no network](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0012-hostile-input-and-no-network.md), [workers and assets](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0011-worker-messaging-and-assets.md) and [ports and adapters](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0008-ports-adapters-and-session.md).

> Status: pre-1.0. The headless core, the React editor and the element are published: opening, multitrack editing with undo, playback, and exporting to WAV ([ADR 0006](docs/adr/0006-multitrack.md)). The API may change between minor versions until 1.0.

## The React editor

```tsx
import "@hussmartinez/ui/styles.css";
import "@hussmartinez/audio-sdk/styles.css";
import { AudioEditor, type AudioEditorHandle } from "@hussmartinez/audio-sdk/react";

const editor = useRef<AudioEditorHandle>(null);

<div style={{ height: "100dvh" }}>
  <AudioEditor ref={editor} initialFile={file} onChange={(plan) => setPlan(plan)} />
</div>;

const { blob } = await editor.current!.export();
```

It shows a toolbar, the timeline with a lane per track (its header, waveform and clips) and the playhead, the transport, an inspector, and the export dialog ([ADR 0005](docs/adr/0005-editor-shell.md), [ADR 0006](docs/adr/0006-multitrack.md)). People open a recording with its button or by dropping a file, and add more, each on a track of its own.

**Styles: ui's stylesheet is required.** Import `@hussmartinez/ui/styles.css` once in your application, before `@hussmartinez/audio-sdk/styles.css`, as above. The editor is built from [`@hussmartinez/ui`](https://www.npmjs.com/package/@hussmartinez/ui)'s components, whose focus rings, minimum target sizes, design tokens, themes and density are in ui's stylesheet ([sdk-core ADR 0036](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0036-ui-as-a-dependency-of-the-sdks.md)). The SDK's stylesheet never includes it, so a page with several SDKs loads it once. The SDK's styles are in the `hm.sdk` cascade layer and use `.hm-audio-*` classes with values from `--hm-*` tokens; `classNames` adds your classes to the editor's parts, and `unstyled` leaves out its own look.

**One copy of ui and sdk-core.** The SDK depends on `@hussmartinez/ui` `^0.14.0` and `@hussmartinez/sdk-core` `^0.4.4`. If your application uses either itself, depend on the same minor versions, and check that `npm ls @hussmartinez/ui @hussmartinez/sdk-core` lists one version of each: a second copy doesn't share providers with the first, so text falls back to English and announcements are lost.

**A bounded height.** `AudioEditor` fills the height of its container, and its timeline scrolls within it, so give it a bounded height: a fixed height, or a grid row such as `minmax(0, 1fr)`. Where the editor is at least 1080 px wide, the inspector sits beside the timeline; otherwise it's below the transport.

**Text.** `messages` overrides any text the editor shows, by key, including ui's, and `locale` sets the language for numbers and plurals ([sdk-core ADR 0046](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0046-ui-text-through-the-sdk.md)). `audioEditorMessages`, from `@hussmartinez/audio-sdk/react`, is the English catalogue. Type your overrides as `MessageOverrides<AudioEditorMessageCatalogue>`: `MessageOverrides` from `@hussmartinez/sdk-core`, and the catalogue's type from the main entry, `@hussmartinez/audio-sdk`, which the element's `messages` uses too (sdk-core ADR 0059). `AudioEditorMessageOverrides` and `AudioEditorMessages` still work, but they're deprecated. `audioMessages`, from the server-safe entry, holds only error and warning text.

| Prop | What it does |
|---|---|
| `initialFile` | A recording opened when the editor mounts |
| `onChange(plan)` | The plan, whenever it changes: when a recording opens or is added, after every edit, and after undo and redo |
| `fileName` | The name an export is downloaded under, without its extension; otherwise the recording's title, or `recording` |
| `onExport(blob, result)` | Takes an export's file instead of the download, and the dialog closes; `result` has the mix's `peakDb` and `clippedFrames` |
| `tools`, `toolbar` | Which tools are present, by id, and the toolbar's groups of them; an unknown id throws |
| `headingLevel` | The level of the editor's headings, from 2 to 6, so they fit your page's outline; 2 by default |
| `theme` | `light`, `dark` or `system`; without it, the editor follows the page's theme |
| `assetsUrl` | Where you serve the package's `dist/assets/`, to self-host the worker (see [Content Security Policy](#content-security-policy)) |
| `filePolicy` | Limits for untrusted files, as for `createAudioSession` |
| `engine`, `processor`, `output` | Your own adapters; the editor makes the SDK's own for any you leave out, and destroys only those |
| `messages`, `locale` | Text overrides and the locale, as above |
| `onEvent` | Anonymous usage events, as for `createAudioSession`, plus `recording_downloaded` when the export dialog's Download asks the browser to download the file. That isn't a confirmed save. With `onExport`, the host saves the file, and that event never comes |
| `className`, `classNames`, `unstyled` | Classes on the root and on the editor's parts, and leaving out the editor's own look |

The ref's `AudioEditorHandle` has `open(file)`, `insert(file, options)`, `export(options)`, `undo()`, `redo()`, `play()`, `pause()` and `seek(frame)`. `export()` exports the plan as it is, without the dialog, and resolves `{ blob, peakDb, clippedFrames }`.

### Exporting

The Export tool opens the export dialog. Export is irreversible, so it shows a summary first: the length, the sample rate and channels, any track a mute or a solo leaves out, and the metadata that will be written. Then the format, 16-bit WAV (the default), 24-bit or 32-bit float, each with the file's exact size. While it runs, a progress bar and Stop; when it's done, Download, which gets focus. The download uses a `blob:` URL, so it makes no request. When the mix went over full scale, the dialog says by how much, and one button lowers the master gain by that and exports again. Closing the dialog stops an export that's running.

### Tools, the toolbar and shortcuts

| Tool | Shortcut | What it does |
|---|---|---|
| `audio.open` | none: `Ctrl+O` is the browser's own | Opens a recording, replacing the current one |
| `audio.insert` | none | Adds a recording on a track of its own |
| `audio.export` | none | Opens the export dialog |
| `audio.undo` | `Ctrl+Z`, or `⌘Z` on Apple platforms | Undoes the last edit |
| `audio.redo` | `Ctrl+Shift+Z` or `Ctrl+Y`, or `⇧⌘Z` | Redoes the last undone edit |
| `audio.add-track`, `audio.remove-track` | none | Adds a track below the current one, or removes the current one; a plan keeps at least one |
| `audio.move-track-up`, `audio.move-track-down` | none | Moves the current track |
| `audio.mute` | `M` | Mutes or unmutes the current track |
| `audio.split` | `S` | Splits the clip under the playhead |
| `audio.delete` | `Delete` or `Backspace` | Deletes the selected range, or else the selected clip |
| `audio.trim-start`, `audio.trim-end` | `[`, `]` | Sets the selected clip's start or end to the playhead |
| `audio.fade-in`, `audio.fade-out` | none | Fades the selected range, or gives the selected clip a half-second fade |
| `audio.move-earlier`, `audio.move-later` | none: `Alt+←` and `Alt+→` on a clip | Moves the selected clip 10 ms |
| `audio.move-to-track-above`, `audio.move-to-track-below` | none: `Alt+↑` and `Alt+↓` on a clip | Moves the selected clip to the next track, at the same time |
| `audio.set-start`, `audio.set-end` | `I`, `O` | Starts or ends the selection at the playhead |
| `audio.clear-selection` | `Escape` | Clears the selection |
| `audio.ripple` | none | Whether deleting a range closes the gap on its tracks; on by default |
| `audio.zoom-in`, `audio.zoom-out`, `audio.zoom-fit` | `+`, `-`, `0` | Zooms the timeline |
| `audio.play-pause` | `Space` | Plays or pauses; not on a button or field, whose own key it is |
| `audio.start`, `audio.end` | `Home`, `End` | Moves the playhead to the start or the end; not in a list, toolbar or slider, whose own keys they are |

On the timeline, `←` and `→` move between a track's clips and `↑` and `↓` between tracks; `Alt+[` and `Alt+]` shorten a clip's start or end by 10 ms, and with `Shift` lengthen it. The playhead steps 10 ms with the arrows and a second with `Page Up` and `Page Down`, and `Shift` with its keys extends the selection. Dragging across the timeline selects a range, and dragging a clip's title moves it.

Shortcuts work only while focus is inside the editor, never on the rest of your page, and never while typing in a field. The toolbar is one tab stop, with arrow keys between its buttons; each button names its shortcut in `aria-keyshortcuts`, and one that can't run is disabled with `aria-disabled`, so it keeps focus. Track and clip edits, selections made with the keyboard, refused moves and finished exports are announced to screen readers.

```tsx
<AudioEditor
  tools={["audio.open", "audio.undo", "audio.redo", "audio.split", "audio.delete"]}
  toolbar={[["audio.open"], ["audio.undo", "audio.redo"], ["audio.split", "audio.delete"]]}
/>
```

### Building blocks

`AudioEditorProvider` holds the session, the output and the editor's state, and `AudioToolbar`, `AudioStage`, `AudioTimeline`, `AudioTransport`, `AudioInspector`, `AudioNotices` and `AudioExportDialog` render inside it, for a layout of your own. `useAudioSession`, `useAudioOutput`, `useAudioPlayhead` and `useAudioMessages` read it; `useAudioPlayhead` updates at most once a frame while playing.

### Server rendering

`@hussmartinez/audio-sdk/react` starts with `"use client"`, so a Next.js Server Component can render the editor directly, and the server-safe entry can run there ([sdk-core ADR 0007](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0007-server-rendering-and-nextjs.md)). On the server it renders the empty editor, with no engine, worker or `AudioContext`; `examples/next` is a working App Router page.

```tsx
import { audioLimits } from "@hussmartinez/audio-sdk";
import { AudioEditor } from "@hussmartinez/audio-sdk/react";

export default function Page() {
  return (
    <main style={{ height: "100%" }}>
      <p>Up to {audioLimits.definitions.maxTracks.default} tracks</p>
      <AudioEditor />
    </main>
  );
}
```

### Content Security Policy

By default the editor's worker is inlined and starts from a `blob:` URL, which needs `worker-src blob:`. Under a stricter policy, self-host it: serve the package's `dist/assets/` and pass its URL as `assetsUrl`, which needs only `worker-src 'self'`. [Worker and Content Security Policy](#worker-and-content-security-policy) has both modes. The editor makes no network requests of its own, and its download uses a `blob:` URL.

## The element

```ts
import "@hussmartinez/ui/styles.css";
import "@hussmartinez/audio-sdk/styles.css";
import {
  type AudioEditorElementProps,
  defineAudioEditorElement,
} from "@hussmartinez/audio-sdk/element";

defineAudioEditorElement();
const editor = document.querySelector("hm-audio-editor") as HTMLElement & AudioEditorElementProps;
editor.file = file;
editor.addEventListener("hm-audio-editor-change", (event) => save((event as CustomEvent).detail));
```

`<hm-audio-editor>` renders `AudioEditor` into its light DOM, for pages without React of their own; React and React DOM, the package's optional peer dependencies, are still needed. Importing the entry registers nothing: call `defineAudioEditorElement()` once, for `hm-audio-editor` or a tag you name. The stylesheet makes the element a block, which you size.

- **Attributes:** `theme` (`light`, `dark` or `system`), `locale`, and `tools`, space-separated.
- **Properties:** `file`, which opens a recording when you set it, `fileName`, `headingLevel`, `filePolicy`, `assetsUrl`, `messages`, `engine`, `processor` and `output`.
- **Methods:** `open`, `insert`, `export`, `undo`, `redo`, `play`, `pause` and `seek`. `open`, `insert`, `export` and `play` wait for the editor's first render.
- **Events:** `hm-audio-editor-change` with the plan, `hm-audio-editor-event` with the usage event, `hm-audio-editor-export` with an `AudioExportReport` after the export dialog finishes (the sample format, size, peak and clamped frames, and no file), and `hm-audio-editor-error` with a failure's `code` and `details`. None carries a file name or contents.

## Editing and exporting

`createAudioSession()` holds what's being edited: a plan of tracks, each with clips of decoded sources placed in time, edited with commands, with undo and redo ([ADR 0003](docs/adr/0003-clip-plan-document-model.md), [ADR 0006](docs/adr/0006-multitrack.md)). It applies the file policy for you, and `export()` mixes the tracks in a worker:

```ts
import { audioMessages, createAudioAdapters, createAudioSession } from "@hussmartinez/audio-sdk";
import { createMessages } from "@hussmartinez/sdk-core";

const messages = createMessages(audioMessages, { locale: "en" });
// The engine, processor and output, made together; yours to destroy.
const adapters = createAudioAdapters(); // or { assetsUrl } to self-host the worker
const session = createAudioSession({
  engine: adapters.engine,
  processor: adapters.processor,
  filePolicy: { maxDuration: 30 * 60 * 1_000 }, // or leave it out for the defaults
  onEvent: (event) => analytics.track(event), // anonymous: no names, samples or metadata
});
session.subscribe(() => render(session.getSnapshot()));
// Or in React: useSyncExternalStore(session.subscribe, session.getSnapshot).

try {
  await session.open(file, { onProgress: showProgress });

  // The recording is one clip on one track. Cut its first second, closing
  // the gap, and fade the rest in over half a second.
  const { plan } = session.getSnapshot();
  const rate = plan?.sampleRate ?? 48_000;
  const [voice] = plan?.tracks ?? [];
  if (voice) {
    session.execute({
      type: "audio.deleteRange",
      start: 0,
      end: rate,
      tracks: [voice.key],
      ripple: true,
    });
  }
  const [clip] = session.getSnapshot().plan?.tracks[0]?.clips ?? [];
  if (clip) {
    session.execute({ type: "audio.setFade", key: clip.key, edge: "in", frames: rate / 2, curve: "equalPower" });
  }

  // Lay music under it, on a track of its own, 12 dB down.
  await session.insert(music, { onProgress: showProgress });
  const bed = session.getSnapshot().plan?.tracks.at(-1);
  if (bed) session.execute({ type: "audio.setTrack", key: bed.key, name: "Music", gainDb: -12 });

  session.execute({ type: "audio.setMetadata", field: "title", value: "Interview" });
  session.undo(); // and session.redo()

  const { blob, peakDb, clippedFrames } = await session.export({
    format: { container: "wav", sampleFormat: "pcm24" },
    onProgress: showProgress,
  });
  if (clippedFrames > 0) warnOfClipping(peakDb); // the mix went this far over full scale
  offerDownload(blob); // the session never downloads anything itself
} catch (error) {
  showError(messages.error(error)); // text by code and reason, never the error's message
}
```

- **The snapshot** has the `plan` (its tracks, their clips in frames, the master gain and the metadata), the `sources`, the `selection`, `canUndo` and `canRedo`, `busy`, the last `error`, and `warnings`: limits past their warning thresholds, and `truncated` for a WAV or AIFF file cut short, which opens with the audio it holds. Show each one's text with `messages.warning(warning)`. (`audioErrorText` and `audioWarningText` still work, but they're deprecated: they call `messages.error` and `messages.warning`.)
- **Tracks** play together. Each has a name, a gain, mute and solo, and clips placed in time that never overlap: two sounds at once are two tracks. `audibleTracks(plan)` says which ones sound.
- **Commands** are plain data, such as `audio.splitClip`, `audio.moveClips` or `audio.setTrack`, with an exact inverse for undo. Clip edits never move another clip: they fail with `clips-overlap` rather than push one. Time edits, `audio.deleteRange`, `audio.keepRange` and `audio.insertTime`, move what's after them on the tracks they name ([the format record](docs/formats/hm-audio-plan.md) lists every command). One that doesn't apply throws `INVALID_COMMAND` with a stable `details.reason`, such as `unknown-clip`. `session.group(fn)` makes several commands, such as a drag, one undo step.
- **Keys you leave out, the session gives:** a split's `newKey`, a new track's `key`, and the `newKeys` of a time edit, one for every track it names. The history records them, so undo and redo bring back the same keys. Pass your own, from `session.createKey()`, when you need to know them before the command runs.
- **A command that changes nothing,** such as a gain that's already set, succeeds without an undo step.
- **The selection** is a range of frames on some tracks, `{ start, end, tracks }`, set with `session.select()`. A time edit clears it, because it moves what was selected. Other edits, undo and redo keep it, clamped to the plan and to its tracks, and cleared when nothing's left.
- **Recordings have names,** for showing people: a `File`'s own name, or the `name` you pass to `open()` or `insert()`, on each entry in `snapshot.sources`. A file's name is hostile input, so it's cleaned as pdf-sdk cleans one: the last path segment, without control, bidirectional formatting or Windows-refused characters, in NFC, without leading dots or surrounding space, and at most 128 code points. Names never go into events, the plan or a document. Show them as text, never as HTML.
- **The session's methods work on their own,** without `session.`, so they can be passed around as `useSyncExternalStore` takes them. So do the output's.
- **`session.insert(file, { track, at })`** adds another recording, as one undo step: on a new track of its own, or on the track you name, where it needs free space. A recording at another sample rate is converted to the session's, in the worker, and its entry in `snapshot.sources` gives the file's own rate as `resampledFrom`. One with more channels widens the plan to its count.
- **Exports** mix the audible tracks as they are when the export starts, up to where the last audible clip ends, as 16-bit (the default) or 24-bit PCM, or 32-bit float WAV, with the metadata in the file. Tracks sum at unity, and the mix is clamped to full scale, never limited or normalised: the result's `peakDb` and `clippedFrames` say how far over it went, so you can lower the master gain with `audio.setMasterGain` and export again. They run under `maxProcessingTime`, and the `signal` option cancels them.
- **Plans are portable JSON:** `toAudioPlanDocument` and `readAudioPlanDocument` write and read the `hm-audio-plan` format, version 2, whose JSON Schema ships in the package, at `@hussmartinez/audio-sdk/formats/hm-audio-plan/v2.schema.json` ([format record](docs/formats/hm-audio-plan.md)). Version 1 documents are read too, as one track, and `migrateAudioCommand` turns a stored version 1 command into version 2's.

## Playback

`createAudioOutput()` plays a plan through Web Audio, and `connectOutput()` keeps it in step with a session, so playback follows every edit, undo and insert, even while playing ([ADR 0002](docs/adr/0002-workers-and-assets.md), [ADR 0003](docs/adr/0003-clip-plan-document-model.md)):

```ts
import { connectOutput, formatTimecode, isAudioError, watchPlayhead } from "@hussmartinez/audio-sdk";

const { output } = adapters; // or createAudioOutput() on its own
const disconnect = connectOutput(session, output);

playButton.onclick = async () => {
  if (output.getSnapshot().state === "playing") return output.pause();
  try {
    await output.play(); // from the playhead, or from the start when it's at the end
  } catch (error) {
    // An autoplay rule kept sound from starting: a press of Play starts it.
    if (isAudioError(error, "UNSUPPORTED_ENVIRONMENT")) showNotice(messages.error(error));
  }
};
output.subscribe(() => showState(output.getSnapshot().state)); // "stopped", "playing" or "paused"

// The playhead isn't in the snapshot: watch it, on animation frames while
// playing and whenever it jumps. It's in whole frames, at the plan's rate.
const rate = session.getSnapshot().plan?.sampleRate ?? 48_000;
const unwatch = watchPlayhead(output, (frame) => {
  drawPlayhead(frame);
  time.textContent = formatTimecode(frame, rate); // "0:12.40"
});

output.seek(5 * 48_000); // while playing, playback carries on from there

// When you're done: stop watching, disconnect, close, then release the adapters.
unwatch();
disconnect();
await session.close();
await adapters.destroy(); // the engine, the processor and the output
```

- **Start playback from a user gesture.** Browsers block audio until someone interacts with the page. The first `play()` creates the one `AudioContext`; if it doesn't start within two seconds, `play()` rejects with `UNSUPPORTED_ENVIRONMENT` and `details.reason` set to `"autoplay-blocked"`, and nothing changes. `messages.error(error)` gives it its own text: sound needs a press of Play.
- **The playhead** is a whole number of frames, read from the audio clock by `output.position()`. It isn't in the snapshot, because it changes on every audio frame, so subscribers aren't called as it moves. They are called when it jumps, after a seek, a stop or a plan that moves it, with a new snapshot in the same state. `watchPlayhead(output, listener)` does the rest: it reads it on animation frames while playing, asks for none otherwise, and calls you only when it changes.
- **`formatTimecode(frames, sampleRate)`** writes a position as an editor shows it: `0:12.40`, and `1:02:05.00` from an hour on. Hundredths are rounded down, so the time shown is never ahead of what's heard.
- **`peakColumns(peaks, { from, to, columns })`** gives a waveform's columns from `session.getPeaks(source)`: each column's lowest and highest sample over every channel, from the overview level that fits, so drawing costs the same for an hour as for a minute.
- **At the end,** the state becomes `stopped` and the playhead stays at the end. `stop()` goes back to the start.
- **Playback is what export renders:** the same audible tracks, track gains and master gain; each clip's gain and fades come from the same `gainAt`, and sources mix into the plan's channels by the same rules. One difference: playback isn't clamped, so the device clips at full scale where export clamps.
- **A mute, a solo, a track's gain and the master gain are heard at once.** A plan that differs only in those is applied to what's playing over 5 ms, without rescheduling a clip, so there's no gap and no click. Any other edit reschedules from the playhead.
- **Opening another recording, or closing,** stops the output at the start. An insert doesn't.
- **The session doesn't own what you give it.** `session.close()` releases the recording, not the engine, the processor or the output: destroy them yourself, as above, with `adapters.destroy()`, or each one's `destroy()` if you made them with `createAudioEngine`, `createAudioProcessor` and `createAudioOutput`.
- **No Content Security Policy directive** is needed for playback: it uses no worker and makes no requests.

## Using the engine directly

The session uses the engine for you. Use it directly for a custom pipeline: `createAudioEngine()` probes a file in a Web Worker, which reads its headers and walks its frames to bound how much audio it can decode to. Check that against your file policy, then decode it and build its waveform overview:

```ts
import {
  audioLimits,
  audioMessages,
  createAudioEngine,
  isAudioError,
} from "@hussmartinez/audio-sdk";
import { checkFile, createMessages, withProcessingTime } from "@hussmartinez/sdk-core";

const policy = audioLimits.resolve({ maxDuration: 30 * 60 * 1_000 }); // or {} for the defaults
const engine = createAudioEngine();
const messages = createMessages(audioMessages, { locale: navigator.language });

try {
  checkFile(policy, file); // the size, before anything is read
  const probe = await engine.probe(file);
  // The bound, never a length a header declares (docs/adr/0004).
  policy.check("maxChannels", probe.channels);
  policy.check("maxSampleRate", probe.sampleRate);
  policy.check("maxDuration", (probe.frameBound / probe.sampleRate) * 1_000);
  policy.check("maxDecodedSize", probe.frameBound * probe.channels * 4);

  const audio = await withProcessingTime(policy, (signal) =>
    engine.decode(file, probe, { signal, onProgress: (fraction) => showProgress(fraction) }),
  );
  const peaks = await engine.peaks(audio);
  // audio is an AudioBuffer at the file's own sample rate.
} catch (error) {
  showError(messages.error(error)); // text by code, never the error's message
  if (isAudioError(error, "DECODE_FAILED")) suggestConvertingToWav();
}
```

`check` returns `"warning"` from a limit's warning threshold, so you can tell people that a long file may be slow. `withProcessingTime` applies `maxProcessingTime`: when it runs out, the engine stops waiting at once and rejects with `PROCESSING_TIME_EXCEEDED`, even if the browser's decoder never finishes (sdk-core [ADR 0031](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0031-platform-decoders-on-the-page.md)).

### Formats

| Container | Codecs | Decoded by |
|---|---|---|
| WAV (RIFF, RF64) | PCM 8 to 32-bit, float 32 and 64-bit, plain and extensible | the SDK, in its worker |
| AIFF, AIFC | PCM 8 to 32-bit, big and little-endian, float 32 and 64-bit | the SDK, in its worker |
| FLAC | FLAC | the browser |
| MP3 | MPEG-1, 2 and 2.5, layers I to III; not free format | the browser |
| ADTS | AAC, including HE-AAC | the browser |
| MP4, M4A | AAC or ALAC, one audio track; not fragmented | the browser |
| Ogg | Opus, Vorbis or FLAC, one stream | the browser |
| WebM, Matroska | Opus, Vorbis, FLAC or AAC, one audio track, other tracks ignored | the browser |

**Compressed formats decode with the browser's own decoders**, on the page, so which of them open varies by browser: a file the browser can't decode fails with `DECODE_FAILED`. [`docs/capabilities.md`](docs/capabilities.md) shows which decode in Chromium, Firefox and WebKit, measured by the end-to-end suite. Before any decoder sees a file, the SDK's own readers bound it from its frames or packets, and refuse what they can't bound. [ADR 0001](docs/adr/0001-audio-engines.md) has the rules for each format.

### Worker and Content Security Policy

| Mode | How | Directives |
|---|---|---|
| Inline (the default) | `createAudioEngine()` and `createAudioProcessor()`: the worker is inlined and starts from a `blob:` URL | `worker-src blob:` |
| Self-hosted | `createAudioAdapters({ assetsUrl: "/audio-sdk/" })`, or the same option for `createAudioEngine` and `createAudioProcessor`: serve the package's `dist/assets/` there; the worker is `audio/audio.worker.js` | `worker-src 'self'` |

Neither mode needs `'unsafe-eval'` or `'wasm-unsafe-eval'`, and the SDK makes no network requests of its own ([ADR 0002](docs/adr/0002-workers-and-assets.md)).

**Copy `dist/assets` again after every upgrade.** A self-hosted worker from another version of the SDK is refused with `WORKER_START_FAILED`, whose `details` name the file and both versions.

### Errors

Every failure is an `AudioError` with a stable `code` and structured `details`; `isAudioError(error, code)` checks one, across workers and copies of the package. Show people the text for the code from `audioMessages` through `createMessages`, never `error.message`. The codes are:

| Code | When |
|---|---|
| `INVALID_AUDIO` | A file is malformed, its headers claim more than its frames carry, or it decodes to more than its bound |
| `UNSUPPORTED_FORMAT` | A container, codec or layout the SDK doesn't read, or a file it can't bound |
| `DECODE_FAILED` | The browser couldn't decode a file the SDK probed, or decoded no audio from it |
| `FILE_TOO_LARGE`, `DECODED_SIZE_TOO_LARGE`, `DURATION_TOO_LONG`, `TOO_MANY_CHANNELS`, `SAMPLE_RATE_TOO_HIGH` | A file exceeds a limit; `details` name it, with its maximum and the actual value ([ADR 0004](docs/adr/0004-audio-limits.md)) |
| `PROCESSING_TIME_EXCEEDED` | `maxProcessingTime` ran out |
| `ABORTED`, `TIMEOUT` | The call's `signal` aborted |
| `UNSUPPORTED_ENVIRONMENT` | The browser lacks a feature, such as Web Audio, which `details.feature` names |
| `WORKER_START_FAILED`, `WORKER_CRASHED` and other `WORKER_*` codes | The worker couldn't start, stopped unexpectedly, or is from another version |

The session adds:

| Code | When |
|---|---|
| `TOO_MANY_FILES`, `SESSION_TOO_LARGE`, `TOO_MANY_CLIPS`, `TOO_MANY_TRACKS` | An insert or an edit would exceed `maxFiles`, `maxSessionSize`, `maxClips` or `maxTracks` |
| `DURATION_TOO_LONG` | An insert or an edit would make the plan longer than `maxDuration`: clips can be placed anywhere, so the plan's length has the limit a file's has |
| `INVALID_COMMAND` | A command doesn't apply, or there's nothing to export; `details.reason` says why, such as `clips-overlap`, `empty-plan` or `nothing-audible` |
| `INVALID_DOCUMENT` | A plan document isn't valid; `details.reason` says why. Another format or a later version is `UNSUPPORTED_FORMAT` |

## Development

The repository root is the published package, laid out as in the family's [standard layout](https://github.com/ie-huss-martinez/sdk-core/blob/main/STANDARDS.md#repository-layout): the source is in [`src`](src), and the pnpm workspace adds [`examples/`](examples), which consume the built package as hosts do, and [`e2e/`](e2e), the end-to-end suite.

You need Node 24 (see [`.node-version`](.node-version)), pnpm, and Docker. The exact pnpm version is pinned in `package.json`, and pnpm switches to it automatically.

```sh
pnpm install       # also installs the git hooks
pnpm verify        # everything CI runs
pnpm verify:fast   # the subset the pre-push hook runs
```

The browser and end-to-end tests run in the pinned browser test image of [`ci/Dockerfile`](ci/Dockerfile), as in CI, through `hm-in-image` ([ADR 0049 in sdk-core](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0049-local-browser-tests-in-the-pinned-image.md)): the host needs Docker, but no Playwright browsers, and its system libraries don't matter. The first run builds the image and installs the dependencies into its own volumes. `pnpm test:browser:all`, or `CI=1`, runs all three engines.

`pnpm verify` runs, in order:

| Step | Script | Tool |
|---|---|---|
| Format and lint | `lint` | Biome |
| CSS rules | `lint:css` | stylelint, with the `hm-` namespace and token rules |
| Types | `typecheck` | TypeScript |
| Dependency rules | `lint:deps` | dependency-cruiser, through `hm-lint-deps` |
| Build | `build` | Vite, then api-extractor for the type declarations |
| Unit tests | `test` | Vitest |
| Browser tests | `test:browser` | Vitest in the browser test image: Chromium, and Firefox and WebKit too in CI |
| Examples | `build:examples` | Vite, building `examples/vite` against the built package |
| End-to-end tests | `test:e2e` | Playwright in the browser test image, against the built example: the [codec capability matrix](docs/capabilities.md), no requests to other origins, and the self-hosted worker under a strict Content Security Policy |
| Size budgets | `check:size` | size-limit: a ceiling on each built entry point, and a budget for each factory an application imports, bundled as its bundler would ([`.size-limit.js`](.size-limit.js)) |
| API reports | `check:api` | api-extractor, one report per entry point in [`api`](api) |
| Package checks | `check:package` | publint and Are the Types Wrong? |

The configuration extends the shared presets in [`@hussmartinez/sdk-config`](https://www.npmjs.com/package/@hussmartinez/sdk-config). The git hooks ([ADR 0016](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0016-git-hooks-and-merge-guards.md)) run automatically: a secret scan and lint of staged files on commit, a Conventional Commits check of the message, and `pnpm verify:fast` on push.

When a change alters the public API on purpose, update the reports with `pnpm api:update` and commit them.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request. Coding agents also start with [`AGENTS.md`](AGENTS.md). Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately, as described in the [security policy](SECURITY.md).

## License

[Apache-2.0](LICENSE)
