---
"@hussmartinez/audio-sdk": minor
---

**Breaking, for TypeScript only:** the types `AudioEditorMessageCatalogue`, `AudioEditorMessages` and `AudioEditorMessageOverrides` are now exported from the main entry, `@hussmartinez/audio-sdk`, and no longer from `@hussmartinez/audio-sdk/react`. Nothing changes at run time, and `audioEditorMessages` itself stays in `@hussmartinez/audio-sdk/react`. Change your imports:

```ts
// Before
import type { AudioEditorMessageOverrides } from "@hussmartinez/audio-sdk/react";
// After
import type { AudioEditorMessageOverrides } from "@hussmartinez/audio-sdk";
```

They moved because the React editor and the `<hm-audio-editor>` element both use them, and the family keeps types shared by several entry points in the main one.

`AudioEditorElementMethods`, the element's methods, is now an interface of its own instead of a `Pick` of `AudioEditorHandle`, with the same eight methods and signatures, and the element's `headingLevel` property is typed `2 | 3 | 4 | 5 | 6`, as `AudioHeadingLevel` is.
