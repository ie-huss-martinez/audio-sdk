---
"@hussmartinez/audio-sdk": minor
---

Adds `connectOutput(session, output)`, which keeps an `AudioOutput`, such as `createAudioOutput()`, playing what the session holds. Edits, undo and inserts reach playback at once, carrying on from the playhead, and closing or replacing the recording stops it at the start. It returns a function that disconnects them. `session.getAudio(id)` gives a source's decoded audio, for playback.
