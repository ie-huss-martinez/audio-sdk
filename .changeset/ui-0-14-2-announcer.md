---
"@hussmartinez/audio-sdk": patch
---

The editor now depends on `@hussmartinez/ui` ^0.14.2, whose announcer says messages raised in the same frame together. A file warning and "Recording opened." are still both announced when a recording opens, now by `ui` instead of the editor's own workaround. Nothing changes in the API.
