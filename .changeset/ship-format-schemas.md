---
"@hussmartinez/audio-sdk": patch
---

The JSON Schemas of `hm-audio-plan` and `hm-audio-command` now ship with the package, as `@hussmartinez/audio-sdk/formats/hm-audio-plan/v1.schema.json` and `@hussmartinez/audio-sdk/formats/hm-audio-command/v1.schema.json`, so a host can validate documents against the schemas that match its installed reader (sdk-core ADR 0045, section 8).
