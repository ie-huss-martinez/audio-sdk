# 0001. Audio engines: our own readers and encoders, and the browser's decoders

- **Status:** Accepted
- **Date:** 2026-11-12
- **Amended:** 2026-11-12, to follow `sdk-core` [ADR 0031](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0031-platform-decoders-on-the-page.md), which makes this record's reading of the worker rule a family rule, and to name [ADR 0012](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0012-hostile-input-and-no-network.md) as that rule's source.
- **Amended:** 2026-11-12, so that native FLAC counts every frame header at its worst case in output terms, whatever its CRC-16, which decoders don't check by default (#12).
- **Amended:** 2026-11-12, so that MP3 and ADTS count every frame header at its worst case too, AAC decodes at twice its core rate at 24 kHz or less, and decoded output may have fewer channels than the probe allows (#14).
- **Amended:** 2026-11-12, so that AAC in MP4 follows ADTS's decode rate, fragmented MP4 and MP4 with several audio tracks are unsupported, and only edit lists that encoders write are accepted (#15).
- **Amended:** 2026-11-12, for Opus and Vorbis in Ogg, with Vorbis's block sizes read from its identification header, and a decode that returns no audio treated as a failure (#16).
- **Amended:** 2026-11-12, for Matroska and WebM: unknown sizes, every lacing, and the codecs read (#17).

## Context

The SDK opens audio files from anywhere, edits them and exports the result, all on the user's device ([ADR 0012](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0012-hostile-input-and-no-network.md)). That takes four jobs:

- **probing:** reading a file's container headers to learn its format, codec, sample rate, channels and duration;
- **decoding:** turning compressed audio, such as MP3, AAC, Vorbis, Opus or FLAC, into PCM samples;
- **rendering:** applying the edits (clip order, trims, gain, fades) to the samples;
- **encoding:** writing the rendered samples to a file.

The family rules point two ways at once. Files must be parsed only in workers ([ADR 0012](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0012-hostile-input-and-no-network.md)), but the browser's own audio decoders, `decodeAudioData` on a `BaseAudioContext`, exist only on the page: neither `AudioContext` nor `OfflineAudioContext` is available in workers. And `decodeAudioData` resamples to its context's sample rate, so decoding on a realtime `AudioContext` silently changes a 44.1 kHz file to the device's 48 kHz. The editor this SDK replaces exported at the wrong rate for exactly that reason.

Licences matter as well. The SDK is Apache-2.0, and every bundled library must be compatible with it and credited in `NOTICE` where its licence requires it ([ADR 0028](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0028-third-party-engines.md)).

## Decision

The first releases bundle **no third-party runtime code**: the SDK's own code probes, parses uncompressed formats, renders and encodes, and the browser decodes compressed formats.

### Probing: our own header readers, in the worker

- **Every file is probed before anything decodes it.** The worker reads the container's headers, with `Blob.slice` and streaming, never by loading the whole file for the probe. It returns the format, codec, the sample rate and channel count the decoder will output, and an upper bound on the frames it will output. The limits are checked against that bound ([ADR 0004](0004-audio-limits.md)).
- **Containers:**
  - WAV (RIFF and RF64) and AIFF/AIFC;
  - FLAC;
  - Ogg (Vorbis, Opus, FLAC);
  - MP3, raw or with an ID3 tag;
  - ADTS AAC;
  - MP4/M4A;
  - WebM and Matroska.
- **Uncompressed files have an exact length:** the size of WAV's `data` chunk or AIFF's `SSND` chunk, divided by the frame size, and cross-checked against the bytes the file actually has.
- **Compressed files are bounded by their packets, never by a header's count.** A header can declare a short duration and carry far more packets, and the decoder decodes the packets. Opus at 6 kbit/s expands about 500 times, so a file under the file-size limit could decode to hundreds of gigabytes. So each reader walks every packet and adds up an upper bound:

  | Codec | Frames per packet |
  |---|---|
  | MP3 | Every valid frame header, found by searching as decoders do, at its worst case: its samples (1,152, 576 or 384), × `ceil(stream rate ÷ frame rate)` when it declares a lower rate, × `ceil(frame channels ÷ stream channels)`. Free-format MP3 isn't supported. WebKit really does follow a mid-stream rate change: on crafted frames it decoded within 11 frames of this bound (#14) |
  | AAC in ADTS | Every valid frame header at its worst case: 1,024 per raw data block × `ceil(decode rate ÷ its core rate)`, × its channel ratio. The decode rate is twice the core rate at 24 kHz or less, as HE-AAC streams are, so implicit SBR, which no header signals, still fits |
  | AAC in MP4 | 1,024 × `ceil(decode rate ÷ core rate)` per `stsz` sample, with the decode rate chosen as for ADTS, so every sample counts as possibly HE-AAC. Every sample's offset and size, from `stco`/`co64`, `stsc` and `stsz`, must lie inside the file, and the tables must account for exactly `stsz`'s samples. Fragmented files (`moof`) and files with several audio tracks are unsupported, rather than bounded by a guess. **Edit lists** can repeat media or add empty time, and FFmpeg, which Chromium decodes through, applies them (Chromium decodes a list that plays the media three times to three times the samples, #15). So only what encoders write is accepted: at most one empty edit no longer than the tolerance, then at most one media edit at rate 1 within the media's duration. Anything else is `UNSUPPORTED_FORMAT` |
  | ALAC in MP4 | The `frameLength` of its configuration, per `stsz` sample, with the same checks |
  | Opus | Exact, from each packet's TOC byte and, for code 3, its frame count, at 48 kHz. A packet that can't be read this way, or that claims more than 120 ms, counts as 120 ms. The granule position counts the pre-skip, so the expected length is the last granule less the pre-skip |
  | Vorbis | At most half of `blocksize_1` per audio packet. The block sizes are in the identification header (packet 1), not the setup header, which holds the codebooks; an identification header that can't be read fails closed |
  | FLAC in Ogg | Exact, from each packet's frame header. A header that disagrees with `STREAMINFO` fails |
  | Native FLAC | Every frame header with a valid CRC-8, found by searching as decoders do, whatever its CRC-16, at its worst case: its block size, × `ceil(stream rate ÷ frame rate)` when it declares a lower rate, × `ceil(frame channels ÷ stream channels)` when it declares more channels. False syncs in the audio data only raise the bound |
  | WebM and Matroska | Every block of the one audio track, counted per laced frame (none, Xiph, EBML or fixed lacing), by its codec's rule above: Opus, Vorbis, FLAC or AAC. The walk is flat, without recursion: a Segment or Cluster of unknown size, as `MediaRecorder` writes, ends at the next Segment-level element or at the end of the file; unknown sizes anywhere else, and elements that overrun their parent, are `INVALID_AUDIO`. Other tracks, such as video, are skipped. Several audio tracks, other codecs and other document types are `UNSUPPORTED_FORMAT`. The Duration is the expected length only within the bound |

  The bound uses the sample rate and channel count the decoder will output, which can differ from the header's. Opus always decodes at 48 kHz, and HE-AAC v2's parametric stereo turns a mono stream into stereo, so AAC is counted as at least two channels, and as eight when a program config element rather than the header sets them. The probe's channel count is therefore a maximum: decoded output may have fewer channels, never more, and never more samples than the bound allows.
- **A header's count gives the expected duration only when it's within the bound.** A Xing, Info or VBRI header, `STREAMINFO`'s total, MP4's `mdhd`, or the last Ogg granule position that claims more than the packets can carry fails with `INVALID_AUDIO`. With no header count, such as the Matroska files `MediaRecorder` writes, the bound is the expected duration.
- **The walk is linear in the file's size** and runs under `maxProcessingTime`. It's the code the fuzz tests guard most.
- **Unknown fails closed.** A file whose container or codec isn't recognised, or whose packets can't be walked to a bound, fails with `UNSUPPORTED_FORMAT` and is never handed to the browser's decoder. So only files whose decoded size is bounded, and within limits, are ever decoded.
- **Malformed fails with a code.** A truncated or inconsistent header fails with `INVALID_AUDIO`, and `details` name the container and what was wrong, never data from the file.

### The readers are hostile-input code

The header readers and packet walkers are the SDK's own parsers for untrusted bytes, so they're held to a stricter bar than the rest of the code:

- **Bounded by construction:**
  - every loop advances by at least one byte;
  - every size read from a file is checked against the bytes that remain before it's used;
  - nesting, such as Matroska's elements or MP4's boxes, has a fixed depth limit;
  - no allocation is sized from file data without the limits being checked first.
- **Tested against garbage:** each reader has:
  - tests that truncate every fixture at every byte offset;
  - tests on random bytes, and on fixtures with headers corrupted on purpose;
  - a property-based fuzz test with `fast-check` (MIT, a devDependency only) that mutates valid fixtures;
  - fixtures whose headers declare far fewer frames than their packets carry, which must fail rather than pass the limits.

  Each case must settle within a fixed time with a result, a bound, `INVALID_AUDIO` or `UNSUPPORTED_FORMAT`, and never hang, throw anything else or crash the worker.
- **Fixtures are generated** by code in the tests, never real recordings.

### Decoding

- **Uncompressed formats, WAV and AIFF in PCM or float, are parsed by our own code in the worker,** at their own sample rate and channel count, with no browser decoder involved. This is most files people edit, and it keeps them out of the page entirely.
- **Compressed formats use `decodeAudioData` on an `OfflineAudioContext` created at the file's probed sample rate,** so nothing is resampled. Its input is a fresh `ArrayBuffer` read from the file's `Blob` with `blob.arrayBuffer()`, which `decodeAudioData` is free to detach, so the file's bytes are never copied a second time.
  - **Why this meets the worker rule:** the browser's decoders are hardened, sandboxed platform code, in the same position as image decoding behind `<img>`. The SDK's own parsing of the file, the probe, still runs in the worker, and only probed files within limits reach the decoder. That's how [ADR 0031](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0031-platform-decoders-on-the-page.md) lets SDKs use platform decoders that exist only on the page, as an exception to [ADR 0012](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0012-hostile-input-and-no-network.md)'s rule that files are parsed only in workers. This SDK meets each of its rules as this record and [ADR 0004](0004-audio-limits.md) describe.
  - **The decode has a time limit.** `decodeAudioData` can't be stopped once it starts, so when `maxProcessingTime` runs out the engine stops waiting, rejects with `PROCESSING_TIME_EXCEEDED`, and discards the result whenever it arrives ([ADR 0031](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0031-platform-decoders-on-the-page.md)).
  - **The decoded length is checked against the bound, with a tolerance.** Decoders legitimately return a little more or fewer frames than a container's count: MP3 encoder delay and padding, AAC priming of 1,024 to 2,112 frames, Opus pre-skip, and browsers differ in which of these they trim. A decoded result longer than the bound plus the codec's tolerance fails with `INVALID_AUDIO` and is discarded. Otherwise the source's length is the decoded length, capped at the bound.

    | Codec | Tolerance |
    |---|---|
    | MP3 | 2 frames (2,304 samples at 1,152 per frame), plus the encoder delay and padding a LAME tag declares |
    | AAC | 2 access units, at the output rate |
    | Opus | 1 maximum packet (5,760 samples) |
    | Vorbis | 1 `blocksize_1` |
    | FLAC, ALAC | 1 maximum block |

  - **A decode that returns no audio is a failure,** `DECODE_FAILED`: WebKit returns an empty buffer for some crafted Opus (#16).
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
- **Trust a header's frame count:** cheap, but a crafted file can declare a short duration and carry hours of packets.

## Consequences

- No bundled engine means no `NOTICE` entries, no WebAssembly and no `'wasm-unsafe-eval'` for the first releases.
- The SDK owns eight container readers and their packet walkers. They're small, but each is new hostile-input code with its own fuzz tests, and the formats' corner cases are ours to get right.
- Probing reads every packet header of a compressed file, which costs a linear pass over the file before it opens. That's the price of a bound that a crafted header can't lie about.
- Codec support for compressed files differs between browsers, and the editor says so with `DECODE_FAILED` rather than hiding it.
- Uncompressed files are never touched by a browser decoder, which is the strongest guarantee the SDK can give for the formats people edit most.
