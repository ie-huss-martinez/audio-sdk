# 0004. Audio limits and session memory

- **Status:** Accepted
- **Date:** 2026-11-12
- **Amended:** 2026-11-13: `maxSessionSize` counts the decoded channels, not the probe's maximum.

## Context

Every SDK enforces limits on untrusted files with `defineLimits` from `sdk-core`, extending `coreLimits`, and hosts change them through `filePolicy` ([ADR 0020](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0020-file-policy.md)). SDKs may change the core limits' defaults.

Audio's risk is the gap between a file's size and its decoded size. Decoded audio is 32-bit floats per sample, per channel. Some examples:

| File | On disk | Decoded |
|---|---|---|
| An hour of 16-bit stereo WAV at 48 kHz | about 690 MB | about 1.4 GB |
| An hour of Opus at 64 kbit/s | about 29 MB | the same 1.4 GB |
| A crafted Opus file: a short declared duration, and packets at 6 kbit/s up to the file-size limit | up to 1 GB | about 500 times that: hundreds of GB |

The sources live on the page ([ADR 0002](0002-workers-and-assets.md)), where running out of memory crashes the host's tab, not just a worker. Browsers on phones allow a tab much less memory than on desktops.

## Decision

### The limits

`audioLimits` is `coreLimits` with audio defaults, plus five audio limits, defined with `defineLimits` so that violations throw `AudioError`:

| Limit | Code | Default maximum | Default warning | Checked |
|---|---|---|---|---|
| `maxFileSize` (core) | `FILE_TOO_LARGE` | 1 GB | 250 MB | Each file, before it's read |
| `maxFiles` (core) | `TOO_MANY_FILES` | 20 | none | The sources in a session, on each insert |
| `maxDecodedSize` (core) | `DECODED_SIZE_TOO_LARGE` | 1 GB | 400 MB | Each file's decoded size, frames × channels × 4 bytes, from the probe's bound, before decoding |
| `maxProcessingTime` (core) | `PROCESSING_TIME_EXCEEDED` | 120 s | none | Each probe, decode, analysis and export |
| `maxDuration` | `DURATION_TOO_LONG` | 3 hours | 1 hour | Each file, from the probe's bound |
| `maxChannels` | `TOO_MANY_CHANNELS` | 8 | none | Each file, from the probe |
| `maxSampleRate` | `SAMPLE_RATE_TOO_HIGH` | 192 kHz | none | Each file, from the probe |
| `maxSessionSize` | `SESSION_TOO_LARGE` | 1.5 GB | 750 MB | The decoded bytes of every source the session holds, on each open and insert |
| `maxClips` | `TOO_MANY_CLIPS` | 2,000 | none | The plan, on each command that adds clips |

- **The core defaults change for audio.** 100 MB of files and 500 MB decoded would refuse a 30-minute WAV. 1 GB decoded fits about 43 minutes of stereo at 48 kHz, which covers most recordings people edit, and stays within what desktop and recent mobile browsers give a tab.
- **These are starting values, measured before the first release** by opening and exporting files at each limit in the end-to-end suites on all three engines, including WebKit as a stand-in for mobile Safari. If they're too high for phones, the defaults go down, and the change gets its own record.
- **`maxDuration` mostly matters at low sample rates and channel counts,** where the decoded size is small. Long timelines still cost time in peaks, playback scheduling and export.

### How each limit behaves

- **Checked before decoding, against an upper bound.** Every limit except `maxSessionSize` and `maxClips` is checked in the worker, before any decoder sees the file ([ADR 0001](0001-audio-engines.md)). Duration and decoded size use the probe's upper bound on the frames the decoder can output:
  - for uncompressed files, their exact length;
  - for compressed files, the sum over every packet, walked in the file, never a count declared in a header.

  A header that claims more than its packets can carry fails with `INVALID_AUDIO`. A file whose packets can't be walked to a bound is refused with `UNSUPPORTED_FORMAT`. So the decoded size is bounded before decoding, and a crafted header can't lower it.
- **A failed check is specific.** It fails the open or insert with `details` naming the limit, its maximum and the actual value, and leaves the session's current document as it was.
- **Decoding is checked again, with a tolerance.** Decoders return slightly more or fewer frames than a container's count, because of encoder delay and padding, AAC priming and Opus pre-skip, and browsers differ. A result longer than the bound plus the codec's tolerance of one or two codec frames ([ADR 0001](0001-audio-engines.md)) is discarded, and the open fails with `INVALID_AUDIO`. Otherwise the source's length is the decoded length, capped at the bound, and that's what the session counts.
- **Inside the browser's decoder,** `decodeAudioData` can't be stopped midway. There, the probe's check is the protection, and `maxProcessingTime` reports a decode that takes too long, though it can't reclaim the memory until the browser finishes.

### Peak memory while opening

The limits count what a session keeps. Opening a file briefly needs more, and the defaults are measured with that included:

- **Compressed files:** about the file's size plus its decoded size. `decodeAudioData` gets a fresh `ArrayBuffer` read from the `Blob`, which it detaches, so the file's bytes aren't held twice ([ADR 0001](0001-audio-engines.md)).
- **Uncompressed files:** the decoded size plus a few blocks, because the worker streams the file into the source's `AudioBuffer` ([ADR 0002](0002-workers-and-assets.md)).
- **Resampling on insert:** a source at another sample rate is held twice, at its own rate and at the session's, until the resampled copy is ready ([ADR 0003](0003-clip-plan-document-model.md)).

So the largest file a session accepts briefly needs about `maxFileSize` plus `maxDecodedSize`, or twice `maxDecodedSize` when it's resampled, on top of the session's other sources. The measurements before the first release open files at these peaks, not only at the limits.

### Session memory

- **`maxSessionSize` counts every source the session holds,** whether the plan or the undo history refers to it. Deleting an inserted file's clips doesn't free its source while undo could bring them back.
- **It counts what the decoder returned:** each source's frames × the decoded channel count × 4 bytes. The probe's channel count is a maximum, used only for the checks before decoding; mono AAC probes as two channels and decodes to one ([ADR 0001](0001-audio-engines.md)). So `maxSessionSize` is checked after decoding, and `maxDecodedSize` is what protects the decode itself.
- **Warnings are part of the snapshot.** At the warning threshold, the snapshot carries a `maxSessionSize` warning, and the editor says that the session is large and that clearing undo history frees memory.
- **The history gives way first.** When an insert would exceed the maximum, the session drops the oldest history steps that are the only references to a source, in `sdk-core`'s `dropOrder` ([ADR 0029](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0029-session-store-and-history.md)), and frees those sources. Only if that isn't enough does the insert fail with `SESSION_TOO_LARGE`. The editor shows when early steps can no longer be undone ([ADR 0010](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0010-edits-as-commands.md)).

### Other error codes

Alongside the limit codes and `sdk-core`'s own (`ABORTED`, `TIMEOUT`, `WORKER_*`, `UNSUPPORTED_ENVIRONMENT`), `AudioError` has:

| Code | When |
|---|---|
| `INVALID_AUDIO` | A file is malformed, its headers claim more than its packets carry, or it decodes to more than its bound allows |
| `UNSUPPORTED_FORMAT` | A container or codec the probe doesn't recognise, a file whose packets can't be walked to a bound, or a sample rate the browser can't decode at |
| `DECODE_FAILED` | The browser couldn't decode a probed file, usually because it lacks the codec |
| `INVALID_COMMAND` | A command that doesn't apply to the plan ([ADR 0003](0003-clip-plan-document-model.md)) |

`details` hold the container, codec, sample rate or limit involved, never data from the file.

### Text

Each code has text under `errors.<CODE>`, and each warning under `warnings.<limit>`, in `src/messages/en.ts` ([ADR 0019](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0019-message-catalogues.md)). A type check fails if any limit's code or warning is missing.

## Alternatives considered

- **Keep the core defaults:** they'd refuse ordinary half-hour recordings.
- **Only check the decoded size after decoding:** by then a hostile file has already used the memory, on the page.
- **Limit only the file size:** compressed audio decodes to 50 times its size or more, so the file size says little about memory.
- **No history trimming, failing the insert instead:** people would lose the ability to open a second file because of undo steps they no longer need.

## Consequences

- Every file's memory cost is bounded and checked before decoding, from its packets rather than its headers, which the replaced editor never did.
- Hosts with long recordings raise `maxDecodedSize` and `maxSessionSize` together, and take responsibility for their users' devices.
- Probing must walk every packet of a compressed file to bound it ([ADR 0001](0001-audio-engines.md)). That's a linear pass before the file opens, under `maxProcessingTime`.
