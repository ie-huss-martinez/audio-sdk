---
"@hussmartinez/audio-sdk": minor
---

The editor's timeline, `AudioTimeline`, on `ui`'s `Timeline`: a lane for each track, with its name, its waveform drawn from the recording's overview and its clips where they sit in time, the playhead as a slider over all of them (10 ms with the arrow keys, a second with Page Up and Page Down), and zoom with Zoom in, Zoom out and Fit to width. `AudioEditor` shows it once a recording is open, and puts focus on the playhead after opening. `classNames` gains a `timeline` part.
