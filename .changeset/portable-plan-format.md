---
"@hussmartinez/audio-sdk": minor
---

Adds the clip plan's portable JSON format, `hm-audio-plan` version 1, with JSON Schemas for it and for the user-level commands, and language-neutral conformance vectors (sdk-core ADR 0045).

- **`toAudioPlanDocument(plan, sources)`** writes a plan, with the sources its clips use, as plain JSON-ready data. **`readAudioPlanDocument(json)`** reads one back, and checks it fully. Another format or a later version fails with `UNSUPPORTED_FORMAT`, and anything else wrong fails with the new `INVALID_DOCUMENT` code, with a `details.reason` from `AudioDocumentRejection`. Text for `errors.INVALID_DOCUMENT` is in `audioMessages`.
- **Commands are strict.** A field a command's type doesn't have now fails with `INVALID_COMMAND` and `malformed-command`, instead of being ignored, as the command schema refuses it.
- **A reversed trim** is refused as `clip-too-short`, not `invalid-frames`.
