---
"@hussmartinez/audio-sdk": patch
---

`@hussmartinez/audio-sdk/react` now tree-shakes: an application that imports only part of it ships only that part. Importing just `audioEditorMessages`, for example, used to bundle nearly the whole editor (about 17 kB brotli) and now bundles about 3 kB. The hooks and building blocks shrink the same way. Module-level calls that a bundler couldn't prove free of side effects, such as `defineTool`, `createContext`, `forwardRef` and the spread that joined the tool lists, are now marked or written so it can. Nothing changes in the API or at run time.
