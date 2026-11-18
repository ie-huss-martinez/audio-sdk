---
"@hussmartinez/audio-sdk": minor
---

The React editor's first parts, in `@hussmartinez/audio-sdk/react`:

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
