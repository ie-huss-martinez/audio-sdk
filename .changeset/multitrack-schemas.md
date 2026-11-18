---
"@hussmartinez/audio-sdk": patch
---

Ship the JSON Schemas of version 2 of the formats, `formats/hm-audio-plan/v2.schema.json` and `formats/hm-audio-command/v2.schema.json`: the multitrack plan, with tracks of clips positioned in time. Nothing in the package reads or writes version 2 yet, and no API changes: `readAudioPlanDocument` and `toAudioPlanDocument` are still version 1's. The session moves to version 2 in a later release, which reads version 1 documents by migrating them.
