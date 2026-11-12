# Codec capabilities

Which of the formats audio-sdk reads each browser engine decodes, measured by the end-to-end suite (`e2e/tests/capabilities.spec.ts`) on generated files, through the real engine. WAV and AIFF decode in the SDK's own worker, so they open everywhere; every other format decodes with the browser's own decoder ([ADR 0001](adr/0001-audio-engines.md)), so support varies.

- **decodes:** the file opened, and decoded within the probe's bound.
- **doesn't decode:** the SDK reads the format, but this browser's decoder refused it (`DECODE_FAILED`), or never finished and was stopped by the time limit (`TIMEOUT`), as WebKit does with FLAC from one run to the next. Either way the engine settles, and the page carries on.

The engines are Playwright's builds, on Linux: Chromium 158.0.8127.18, Firefox 159.0 and WebKit 27.2. **Playwright's WebKit isn't Safari:** it lacks the proprietary codecs Safari ships, such as AAC and FLAC, so Safari opens more than its column shows.

Vorbis and ALAC aren't in the table: they need real encoders to generate decodable files, and the SDK's tests exercise them through the probe only.

The suite fails when a browser's outcome differs from this table. After a browser update, regenerate it from all three engines with `pnpm build && pnpm build:examples && UPDATE_CAPABILITIES=1 pnpm test:e2e`, and review the difference.

| Format | Chromium | Firefox | WebKit |
|---|---|---|---|
| WAV, 16-bit PCM | decodes | decodes | decodes |
| WAV, 32-bit float | decodes | decodes | decodes |
| WAV (RF64), 24-bit PCM | decodes | decodes | decodes |
| AIFF, 16-bit PCM | decodes | decodes | decodes |
| AIFC, little-endian PCM (sowt) | decodes | decodes | decodes |
| AIFC, 32-bit float (fl32) | decodes | decodes | decodes |
| FLAC | decodes | decodes | doesn't decode |
| FLAC in Ogg | decodes | decodes | doesn't decode |
| MP3, MPEG-1 Layer III, 44.1 kHz | decodes | decodes | decodes |
| MP3, MPEG-2 Layer III, 22.05 kHz | decodes | decodes | decodes |
| MP3, MPEG-2.5 Layer III, 8 kHz | decodes | decodes | decodes |
| MP3 with an Info tag and LAME's delay | decodes | decodes | decodes |
| AAC-LC in ADTS, 44.1 kHz | decodes | decodes | doesn't decode |
| AAC-LC in ADTS, 22.05 kHz | decodes | decodes | doesn't decode |
| AAC-LC in MP4 (M4A) | decodes | decodes | doesn't decode |
| Opus in Ogg | decodes | decodes | decodes |
| Opus in WebM | decodes | decodes | decodes |
| Opus in WebM, as MediaRecorder writes it | decodes | decodes | decodes |
