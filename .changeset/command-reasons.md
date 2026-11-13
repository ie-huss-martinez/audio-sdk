---
"@hussmartinez/audio-sdk": minor
---

Every `INVALID_COMMAND` error now has a stable `details.reason` token saying why, such as `clip-too-short`, `unknown-clip`, `key-taken` or `no-recording`. Branch on it instead of the message, which is for developers and may change. The tokens are the new `AudioCommandRejection` type, and a clip's own problems are `AudioClipProblem`. They never change meaning once released (sdk-core ADR 0045).
