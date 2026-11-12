# 0001. Audio engines: our own readers and encoders, and the browser's decoders

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

The SDK opens audio files from anywhere, edits them and exports the result, all on the user's device ([ADR 0012](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0012-hostile-input-and-no-network.md)). That takes four jobs:

- **probing:** reading a file's container headers to learn its format, codec, sample rate, channels and duration;
- **decoding:** turning compressed audio, such as MP3, AAC, Vorbis, Opus or FLAC, into PCM samples;
- **rendering:** applying the edits (clip order, trims, gain, fades) to the samples;
- **encoding:** writing the rendered samples to a file.

The family rules point two ways at once. Files must be parsed only in workers ([ADR 0020](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0020-file-policy.md)), but the browser's own audio decoders, `decodeAudioData` on a `BaseAudioContext`, exist only on the page: neither `AudioContext` nor `OfflineAudioContext` is available in workers. And `decodeAudioData` resamples to its context's sample rate, so decoding on a realtime `AudioContext` silently changes a 44.1 kHz file to the device's 48 kHz. The editor this SDK replaces exported at the wrong rate for exactly that reason.

Licences matter as well. The SDK is Apache-2.0, and every bundled library must be compatible with it and credited in `NOTICE` where its licence requires it ([ADR 0028](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0028-third-party-engines.md)).

## Decision

The first releases bundle **no third-party runtime code**: the SDK's own code probes, parses uncompressed formats, renders and encodes, and the browser decodes compressed formats.

### Probing: our own header readers, in the worker

- **Every file is probed before anything decodes it.** The worker reads the container's headers, with `Blob.slice` and streaming, never by loading the whole file for the probe. It returns the format, codec, sample rate, channel count and frame count, which the limits are checked against ([ADR 0004](0004-audio-limits.md)).
- **Containers:**
  - WAV (RIFF and RF64) and AIFF/AIFC;
  - FLAC;
  - Ogg (Vorbis, Opus, FLAC);
  - MP3, raw or with an ID3 tag;
  - ADTS AAC;
  - MP4/M4A;
  - WebM and Matroska.
- **Duration is established, not guessed.** Each reader uses the container's own count where it has one: WAV's data size, FLAC's `STREAMINFO`, MP4's `mdhd`, the last Ogg page's granule position, an MP3 Xing, Info or VBRI header. Where it doesn't, the reader walks the frames or clusters and counts them: MP3 and ADTS frame headers, and Matroska clusters, which `MediaRecorder` often writes without a duration. A walk is linear in the file's size and runs under `maxProcessingTime`.
- **Unknown fails closed.** A file whose container isn't recognised, or whose duration can't be established, fails with `UNSUPPORTED_FORMAT` and is never handed to the browser's decoder. So only files whose decoded size is known, and within limits, are ever decoded.
- **Malformed fails with a code.** A truncated or inconsistent header fails with `INVALID_AUDIO`, and `details` name the container and what was wrong, never data from the file.

### The readers are hostile-input code

The header readers are the SDK's own parsers for untrusted bytes, so they're held to a stricter bar than the rest of the code:

- **Bounded by construction:**
  - every loop advances by at least one byte;
  - every size read from a file is checked against the bytes that remain before it's used;
  - nesting, such as Matroska's elements or MP4's boxes, has a fixed depth limit;
  - no allocation is sized from file data without the limits being checked first.
- **Tested against garbage:** each reader has:
  - tests that truncate every fixture at every byte offset;
  - tests on random bytes, and on fixtures with headers corrupted on purpose;
  - a property-based fuzz test with `fast-check` (MIT, a devDependency only) that mutates valid fixtures.

  Each case must settle within a fixed time with a result, `INVALID_AUDIO` or `UNSUPPORTED_FORMAT`, and never hang, throw anything else or crash the worker.
- **Fixtures are generated** by code in the tests, never real recordings.

### Decoding

- **Uncompressed formats, WAV and AIFF in PCM or float, are parsed by our own code in the worker,** at their own sample rate and channel count, with no browser decoder involved. This is most files people edit, and it keeps them out of the page entirely.
- **Compressed formats use `decodeAudioData` on an `OfflineAudioContext` created at the file's probed sample rate,** so nothing is resampled. Its input is a copy, because `decodeAudioData` detaches the buffer it's given.
  - **Why this meets the worker rule:** the browser's decoders are hardened, sandboxed platform code, in the same position as image decoding behind `<img>`. The SDK's own parsing of the file, the probe, still runs in the worker, and only probed files within limits reach the decoder. This is recorded here as this SDK's interpretation of [ADR 0020](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0020-file-policy.md)'s rule. It's raised in `sdk-core`, so that its standards can say how SDKs treat platform decoders, as [ADR 0028](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0028-third-party-engines.md) did for third-party engines' workers.
  - **Codec support follows the browser.** A file the browser can't decode fails with `DECODE_FAILED` and `details.codec`, never with the browser's message. The end-to-end suites keep a capability matrix of each codec in Chromium, Firefox and WebKit.
  - **Sample rates a browser can't create a context for** fail with `UNSUPPORTED_FORMAT` and `details.sampleRate`. The specification requires 8 to 96 kHz, and browsers support more.

### Rendering: a pure function, shared by preview and export

- **One definition of the result.** `gainAt(clip, frame)` gives the gain at every frame of a clip, from its gain and its fades (linear or equal-power). Export applies it per sample. Playback samples it into `setValueCurveAtTime` on each clip's `GainNode`. So playback and export follow the same envelope by construction, which the replaced editor didn't.
- **Export renders in the worker** with plain TypeScript, block by block: deterministic, testable in Node, cancellable and with progress ([ADR 0002](0002-workers-and-assets.md)).
- **A browser contract test** renders a plan through the playback graph in an `OfflineAudioContext` and through the worker. It requires the two to agree within a small tolerance, so a change to either path that makes them diverge fails.

### Encoding: WAV, written by our code

- **The first format is WAV:** PCM 16-bit (the default), PCM 24-bit or 32-bit float, at the session's sample rate and channel count.
- **Metadata goes into the file,** as a `LIST`/`INFO` chunk:
  - `INAM` (title), `IART` (artist), `IPRD` (album), `ICRD` (year) and `ICMT` (comment);
  - written as UTF-8, and length-limited.

  This replaces the replaced editor's JSON sidecar.
- **Samples are clamped before they're quantised,** so a gain above full scale clips rather than wrapping around.

### Later formats, each with its own record

- **Lossy export (Opus, and AAC where the browser has it)** through WebCodecs' `AudioEncoder`, in the worker, behind capability detection. It needs a muxer. The leaning is towards `mediabunny` (MPL-2.0: file-level copyleft, which is compatible with distributing it in an Apache-2.0 package if its files stay unmodified, and needs a `NOTICE` entry) over writing Ogg and MP4 muxers ourselves, because maintained muxers beat ones we'd write. Its own ADR decides.
- **FLAC export** through libFLAC (BSD-3-Clause) compiled to WebAssembly, only if its size is worth it. That would also bring in `'wasm-unsafe-eval'` and the WebAssembly asset rules of [ADR 0002](0002-workers-and-assets.md).

## Alternatives considered

- **Decode everything with `decodeAudioData` on a realtime `AudioContext`:** what the replaced editor did. It resamples to the device's rate, needs an `AudioContext` before the user has asked to play, and hands every file, probed or not, to the decoder.
- **Decode in the worker with WebCodecs' `AudioDecoder`:** it would keep decoding in the worker, but it needs a demuxer for every container, and its codec support varies more than `decodeAudioData`'s. It's worth revisiting for streaming large files, behind the same port.
- **ffmpeg compiled to WebAssembly:** every format at once, but it's LGPL or GPL, depending on the build, over 25 MB, and needs cross-origin isolation for threads. Its parsers would also become the SDK's attack surface.
- **MP3 export with LAME:** LAME is LGPL, which is awkward to bundle in an Apache-2.0 package and to replace as the LGPL requires. MP3 export isn't offered.
- **Render exports in an `OfflineAudioContext`:** it would share the playback graph exactly, but it runs only on the page, can't be cancelled midway or report progress, and holds the whole result in memory. It's used as the test oracle instead.
- **Accept files whose duration is unknown, and check the decoded size afterwards:** a compressed file can decode to gigabytes before any check could run, inside the page.

## Consequences

- No bundled engine means no `NOTICE` entries, no WebAssembly and no `'wasm-unsafe-eval'` for the first releases.
- The SDK owns eight container readers. They're small, but each is new hostile-input code with its own fuzz tests, and the formats' corner cases are ours to get right.
- Codec support for compressed files differs between browsers, and the editor says so with `DECODE_FAILED` rather than hiding it.
- Uncompressed files are never touched by a browser decoder, which is the strongest guarantee the SDK can give for the formats people edit most.
