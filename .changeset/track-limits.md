---
"@hussmartinez/audio-sdk": minor
---

Limit the number of tracks and the plan's length. A new limit, `maxTracks`, defaults to 16: a command or an insert that would add a track past it throws `TOO_MANY_TRACKS`, a new error code, with text in `audioMessages`. And `maxDuration`, 3 hours by default, now bounds the plan's length as well as each file's: an edit or an insert that would make the plan longer throws `DURATION_TOO_LONG`. Clips can be placed anywhere on the timeline, so without it one command could ask for hours of silence.

Both leave the plan as it was, and both are changed through `filePolicy`, such as `{ maxTracks: 32 }`. `maxClips` counts the clips of every track together.

If you handle error codes exhaustively, add `TOO_MANY_TRACKS`. If you supply your own message catalogue, add `errors.TOO_MANY_TRACKS` and `warnings.maxTracks`.
