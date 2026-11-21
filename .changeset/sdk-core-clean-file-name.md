---
"@hussmartinez/audio-sdk": patch
---

A recording's name, and an export's file name, are now cleaned by sdk-core's `cleanFileName`, the family's one implementation, instead of a copy of it. Names come out as before, with one difference: half of a surrogate pair, which isn't text, is now dropped, so a name is always well-formed Unicode. `MAX_SOURCE_NAME_LENGTH` is still 128, now taken from sdk-core's `MAX_FILE_NAME_LENGTH`. The package now needs `@hussmartinez/sdk-core` ^0.4.7.
