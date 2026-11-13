---
"@hussmartinez/audio-sdk": minor
---

Adds `createAudioProcessor({ assetsUrl, idleTimeout })`, the SDK's `AudioProcessor`: it renders a plan and encodes it as WAV, in its own worker, block by block, with progress and cancellation.

- **Formats:** 16-bit PCM (the default), 24-bit PCM or 32-bit float, at the plan's sample rate and channel count, as RF64 when the file is over 4 GiB.
- **Rendering:** each clip's gain and fades, exactly as `gainAt` defines them. Sources with another channel count mix by Web Audio's speaker rules, so export matches playback.
- **Quantisation:** clamped to full scale, then rounded half away from zero, without dither. A non-finite sample is written as silence.
- **Metadata:** written as a `LIST`/`INFO` chunk of UTF-8 text. Empty fields are left out.
