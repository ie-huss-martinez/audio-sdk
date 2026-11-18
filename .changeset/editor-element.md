---
"@hussmartinez/audio-sdk": minor
---

**`<hm-audio-editor>`**, the editor as a custom element, from `@hussmartinez/audio-sdk/element`. Importing the entry registers nothing: call `defineAudioEditorElement()`, once, for the tag or one you name. It renders `AudioEditor` into the element's light DOM, so React and React DOM are needed, and you load `@hussmartinez/ui/styles.css` and then this package's `styles.css`.

- **Attributes:** `theme` (`light`, `dark` or `system`), `locale`, and `tools`, space-separated.
- **Properties:** `file`, which opens a recording when you set it, `fileName`, `headingLevel`, `filePolicy`, `assetsUrl`, `messages`, `engine`, `processor` and `output`.
- **Methods:** `open`, `insert`, `export`, `undo`, `redo`, `play`, `pause` and `seek`.
- **Events:** `hm-audio-editor-change` with the plan, `hm-audio-editor-event` with the usage event, `hm-audio-editor-export` with an `AudioExportReport` after the export dialog finishes (format, size, peak and clamped frames, no file), and `hm-audio-editor-error` with a failure's `code` and `details`. None carries a file name or contents.
