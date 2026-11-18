---
"@hussmartinez/audio-sdk": patch
---

The editor now depends on `@hussmartinez/ui` ^0.14.1. Keyboard users see the whole focus ring around the timeline's playhead and around the text field in the rename dialog; before, part of each ring was cut off. To make room for the playhead's ring, the timeline's ruler row is a few pixels taller and its lanes are a few pixels narrower at each end. Nothing changes in the API.
