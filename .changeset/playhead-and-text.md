---
"@hussmartinez/audio-sdk": minor
---

Helpers for building playback and text on the session.

- **`watchPlayhead(output, listener)`** follows the playhead without a framework: it calls you with the frame now, on animation frames while playing, and whenever the playhead jumps. Returns a function that stops it.
- **The output notifies subscribers when the playhead jumps,** after a seek, a stop or a plan that moves it, with a new snapshot in the same state. Before, a seek while paused told nobody. `position()` is a whole number of frames. **If you pass your own `output`,** it must do the same.
- **`formatTimecode(frames, sampleRate)`** gives `0:12.40`, or `1:02:05.00` from an hour on, rounded down to hundredths.
- **`peakColumns(peaks, { from, to, columns })`** gives each column of a waveform its lowest and highest sample, from the overview level that fits the zoom.
- **`audioErrorText(messages, error)`** gives an error's text by its code and its `details.reason` together, falling back to `messages.error()`. A blocked `play()` now has `details.reason: "autoplay-blocked"` and says that sound needs a press of Play, rather than that the browser lacks a feature. An edit that would make the plan too long has `details.reason: "plan-too-long"`, with its own text.
- **`audioWarningText(messages, warning)`** gives any of the snapshot's warnings its text.

The catalogue gains `errors.UNSUPPORTED_ENVIRONMENT.autoplay-blocked` and `errors.DURATION_TOO_LONG.plan-too-long`. If you supply your own catalogue, add them.
