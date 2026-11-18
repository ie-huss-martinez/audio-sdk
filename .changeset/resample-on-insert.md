---
"@hussmartinez/audio-sdk": minor
---

Insert recordings at any sample rate. `session.insert()` used to refuse a file whose rate differed from the session's with `UNSUPPORTED_FORMAT`; it now converts it to the session's rate, in the worker, with progress and cancellation. The converted source reports the file's own rate as `resampledFrom` in `snapshot.sources`.

`AudioEngine.decode()` takes a new option, `sampleRate`, the rate to return the audio at. The SDK's engine converts with its own windowed-sinc resampler, so every browser gives the same samples. **If you pass your own `engine`,** it must honour `sampleRate` too: the session refuses audio at any other rate with `INVALID_AUDIO`.
