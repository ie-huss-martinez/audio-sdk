---
"@hussmartinez/audio-sdk": minor
---

Adds `createAudioOutput()`, the SDK's `AudioOutput`: it plays a plan through Web Audio, from the playhead, and reschedules from the playhead whenever the plan changes or it seeks, so an edit or a seek during playback always takes effect.

- **Rendering:** each clip plays its source through a gain that follows `gainAt`, so playback matches export, gains and fades included. Sources with other channel counts mix into the plan's by Web Audio's speaker rules, as export mixes them.
- **The playhead:** `position()` reads it from the audio clock, for a view to poll on animation frames. When playback reaches the end, the state becomes `stopped`.
- **Starting audio:** the first `play()` should come from a click or a key press, as browsers require. If audio output doesn't start within two seconds, `play()` rejects with `UNSUPPORTED_ENVIRONMENT`, and the output stays as it was.
