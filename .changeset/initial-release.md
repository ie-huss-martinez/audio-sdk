---
"@hussmartinez/audio-sdk": minor
---

First release of `@hussmartinez/audio-sdk`, an audio SDK that works entirely in the browser: audio is opened, edited and exported on the user's device and never uploaded.

- **Package shape:** an ES module package with a server-safe headless core (`@hussmartinez/audio-sdk`), a React entry (`@hussmartinez/audio-sdk/react`), a custom element entry (`@hussmartinez/audio-sdk/element`) and one stylesheet (`@hussmartinez/audio-sdk/styles.css`), which applications import once. React and React DOM 18.3 or later are optional peer dependencies.
- **Errors:** every failure is an `AudioError` with a stable `code`, such as `INVALID_AUDIO`, `UNSUPPORTED_FORMAT`, `DECODE_FAILED` or `TOO_MANY_CHANNELS`, and structured `details`. `isAudioError(error, code)` checks one, across workers and copies of the package.
- **Limits for untrusted files:** `audioLimits` adds `maxDuration`, `maxChannels`, `maxSampleRate`, `maxSessionSize` and `maxClips` to the family's limits on file size, file count, decoded size and processing time, with defaults sized for audio: 1 GB per file and 1 GB of decoded audio. Set them with a `filePolicy`; a misspelt limit name throws instead of being ignored.
- **Translatable text:** `audioMessages` is the English catalogue for every error code and limit warning, for `createMessages` from `@hussmartinez/sdk-core`. Error text comes from the code and its details, never from the error's message.
