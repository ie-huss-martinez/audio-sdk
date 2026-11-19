---
"@hussmartinez/audio-sdk": patch
---

`<hm-audio-editor>`'s `open()`, `insert()`, `export()` and `play()` no longer wait forever when the element is removed before its editor has rendered. They now reject with an `AudioError` whose code is `ABORTED` and whose `details.reason` is `"removed"`. Before, a call made right after connecting the element and followed by its removal, such as on a quick route change, never settled.
