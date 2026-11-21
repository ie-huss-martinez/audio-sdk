---
"@hussmartinez/audio-sdk": patch
---

`AudioEditorMessages` and `AudioEditorMessageOverrides` are deprecated, and go in the next breaking release. The family names the editor's catalogue type once, `AudioEditorMessageCatalogue`, and builds the rest from sdk-core's types:

```ts
import type { AudioEditorMessageCatalogue } from "@hussmartinez/audio-sdk";
import type { MessageOverrides, Messages } from "@hussmartinez/sdk-core";

// Before: AudioEditorMessageOverrides and AudioEditorMessages
const overrides: MessageOverrides<AudioEditorMessageCatalogue> = { "track.solo": "Solo" };
type EditorText = Messages<AudioEditorMessageCatalogue>;
```

They're the same types, so nothing else changes: the `messages` props of `AudioEditor`, `AudioEditorProvider` and `<hm-audio-editor>`, and `useAudioMessages()`, are now written with them.
