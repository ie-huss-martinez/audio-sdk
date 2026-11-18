---
"@hussmartinez/audio-sdk": patch
---

Muting, soloing and changing a track's gain or the master gain during playback now take effect at once, without a gap. `createAudioOutput()` used to stop and reschedule every clip on any change of the plan; a plan that differs only in those levels is now applied to what's playing, over 5 ms. Other edits still reschedule from the playhead. Nothing changes in the API.
