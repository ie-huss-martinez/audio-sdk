# 0002. One audio worker, sources on the page, and assets without the network

- **Status:** Accepted
- **Date:** 2026-11-12
- **Amended:** 2026-11-12, with the self-hosted worker's version check (#19).
- **Amended:** 2026-11-13: the version check is sdk-core's `packageVersion` handshake ([ADR 0038](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0038-self-hosted-assets-and-worker-version.md)), instead of a `version` call in the worker's contract.

## Context

[ADR 0001](0001-audio-engines.md) puts probing, uncompressed parsing, rendering and encoding in a worker, and leaves decoding of compressed formats and playback to Web Audio, which exists only on the page. The decoded audio, the sources, has to live somewhere both can reach, and it's large: an hour of stereo at 48 kHz is about 1.4 GB as 32-bit floats.

The family's rules for workers apply ([ADR 0011](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0011-worker-messaging-and-assets.md), [ADR 0018](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0018-worker-rpc-protocol.md)): typed RPC from `sdk-core`, copied inputs unless the caller transfers them, cancellation and progress, `exposeWorker` before heavy work, and assets that are inlined by default or self-hosted, never fetched from elsewhere.

## Decision

### Where the audio lives

- **Sources are `AudioBuffer`s on the page,** one per opened or inserted file, created once and never modified ([ADR 0003](0003-clip-plan-document-model.md)). Playback needs them there, and keeping a single copy is what makes the limits in [ADR 0004](0004-audio-limits.md) hold.
- **The worker holds no sources.** It receives the samples it needs in blocks, and keeps nothing between calls beyond what an export or analysis in progress needs. A crashed or terminated worker therefore loses no session data.
- **Blocks are bounded.** Every transfer between the page and the worker is a block of at most 2¹⁶ frames per channel, copied out with `copyFromChannel` and transferred. The memory an operation adds is a few blocks, never a second copy of a source.

### The audio worker: the family RPC

One worker module exposes the engine's and processor's worker side with `exposeWorker` ([ADR 0003](0003-clip-plan-document-model.md) defines the ports). `createAudioEngine()` and `createAudioProcessor()` reach it with `createWorkerClient`. Its methods are:

- **`probe(file)`:** reads the headers of a `Blob` ([ADR 0001](0001-audio-engines.md)).
- **`parse(file)`:** streams the samples of a WAV or AIFF file back as blocks, which the page copies into the source's `AudioBuffer` as they arrive, with progress.
- **`peaks(blocks)`:** builds a source's waveform overview, a min/max pyramid at several zoom levels. It's computed once per source and kept on the page, so drawing the waveform never scans samples. Uncompressed files get it while they're parsed.
- **`beginExport`, `renderBlock`, `endExport`:** one export. The page sends each output block's source samples, and the worker applies the clips' gain and fades and returns encoded bytes. The page collects those into a `Blob` of parts, so the output is never one large `ArrayBuffer`. The WAV header is written first, since the plan fixes the length in advance.

Every call takes an `AbortSignal`, and long ones report progress.

### Clients and lifetimes

- **Two clients.** One runs probes, parses and exports in order. A second runs analysis, such as waveform peaks, and later loudness. Cancelling slow analysis can terminate its worker, and with separate clients that never fails a pending export as collateral ([ADR 0018](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0018-worker-rpc-protocol.md)).
- **Lifetimes:** workers start on the first file, stop after `sdk-core`'s idle timeout, and stop with their session.

### Web Audio on the page

- **Decoding** uses a fresh `OfflineAudioContext` per file, at its sample rate ([ADR 0001](0001-audio-engines.md)). It needs no audio device and no user gesture.
- **Playback** is the `AudioOutput` adapter. It creates one `AudioContext` lazily, on the first play, which is a user gesture, as browsers' autoplay rules require. It closes the context with its session.
  - **Each clip is an `AudioBufferSourceNode`** on its source, started at the clip's offset, followed by a `GainNode` whose automation comes from `gainAt` ([ADR 0001](0001-audio-engines.md)).
  - **Playback is a function of the plan and the playhead.** Seeking, or any edit while playing, stops the scheduled nodes and schedules again from the current position. The replaced editor's bugs, where seeking or editing during playback didn't take effect, can't arise.
- **No `AudioWorklet` in the first releases.** It would need a module URL, with its own asset and CSP rules, and nothing yet needs custom processing on the audio thread.

### Assets

- **Inline (the default):** the worker is inlined and started from a `blob:` URL.
- **Self-hosted:** `assetsUrl` is where the application serves the package's `dist/assets/`, as in `pdf-sdk`. The worker is `dist/assets/audio/audio.worker.js`, one minified file with a fixed name.
- **The worker's version is checked.** A self-hosted worker copied before an upgrade speaks the same protocol but runs older code. So the worker announces the package version it was built from when it starts, through sdk-core's `exposeWorker`, and the engine's worker clients refuse a mismatch, or a worker that announces none, with `WORKER_START_FAILED`, naming the asset and both versions. Every SDK in the family checks its workers the same way. It's the counterpart of `pdf-sdk`'s hash check of `qpdf.wasm`; there's no WebAssembly to hash here.
- **No WebAssembly** in the first releases ([ADR 0001](0001-audio-engines.md)). A later codec that needs it follows the same directory, with its hash checked before it's compiled, as in `pdf-sdk`.

### Content Security Policy

| Mode | Directives |
|---|---|
| Inline (default) | `worker-src blob:` |
| Self-hosted | `worker-src 'self'` |

Neither mode needs `'unsafe-eval'` or `'wasm-unsafe-eval'`. Web Audio needs no directive.

### Tests

- The end-to-end suites fail on any request to another origin, and assert that inline mode makes no request at all beyond the page and its scripts.
- The self-hosted mode runs the same fixtures with `assetsUrl` set and a CSP without `blob:`.
- A unit test checks that no transfer between the page and the worker exceeds the block size.

## Alternatives considered

- **Sources in the worker, with playback streamed to the page:** the page would hold almost no audio. But playback would need an `AudioWorklet` fed from the worker through a ring buffer, with `SharedArrayBuffer` and cross-origin isolation, which hosts can't always set. It's worth revisiting for very long files.
- **Sources in both places:** simplest to write, but it doubles memory, the SDK's tightest resource.
- **Render and encode on the page:** the arithmetic is cheap, but an hour-long export would still block the page for seconds, and later codecs belong in a worker anyway.
- **One client for everything:** cancelling a slow analysis would kill an export in progress.

## Consequences

- An export moves every sample across the worker boundary once, in blocks. That's cheap next to encoding, and it keeps memory flat.
- The page's memory holds the sources, so the limits on decoded size and session size are the ones that protect users ([ADR 0004](0004-audio-limits.md)).
- Playback rescheduling is simple, but a very large plan, with thousands of clips, schedules many nodes at once. `maxClips` bounds that.
