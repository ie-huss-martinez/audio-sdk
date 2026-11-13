---
"@hussmartinez/audio-sdk": patch
---

The 1,000 limit on a metadata value now counts Unicode code points, as the `hm-audio-plan` schema's `maxLength` does, instead of UTF-16 code units, in `audio.setMetadata` and in `readAudioPlanDocument`. Text outside the Basic Multilingual Plane, such as emoji, may now be up to 1,000 characters long, where it was refused past 500.
