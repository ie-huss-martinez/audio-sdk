# audio-sdk

A client-side audio SDK: trim, split, fade, adjust gain and export audio entirely in the browser. Audio never leaves the device. Its headless core is published; a React editor (`AudioEditor`) and a `<hm-audio-editor>` custom element come later.

This repository publishes **[`@hussmartinez/audio-sdk`](https://www.npmjs.com/package/@hussmartinez/audio-sdk)**. It follows the family standards in [`sdk-core`'s `STANDARDS.md`](https://github.com/ie-huss-martinez/sdk-core/blob/main/STANDARDS.md), and in particular the decisions on [hostile input and no network](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0012-hostile-input-and-no-network.md), [workers and assets](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0011-worker-messaging-and-assets.md) and [ports and adapters](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0008-ports-adapters-and-session.md).

> Status: pre-1.0. The headless core is published: opening, editing with undo, and exporting to WAV. Playback and the editor UI are next, and the API may change between minor versions until 1.0.

## Editing and exporting

`createAudioSession()` holds the recording being edited: a clip plan over decoded sources, edited with commands, with undo and redo ([ADR 0003](docs/adr/0003-clip-plan-document-model.md)). It applies the file policy for you, and `export()` renders the result in a worker:

```ts
import {
  audioMessages,
  createAudioEngine,
  createAudioProcessor,
  createAudioSession,
} from "@hussmartinez/audio-sdk";
import { createMessages } from "@hussmartinez/sdk-core";

const messages = createMessages(audioMessages, { locale: "en" });
const session = createAudioSession({
  engine: createAudioEngine(),
  processor: createAudioProcessor(),
  filePolicy: { maxDuration: 30 * 60 * 1_000 }, // or leave it out for the defaults
  onEvent: (event) => analytics.track(event), // anonymous: no names, samples or metadata
});
session.subscribe(() => render(session.getSnapshot())); // or useSyncExternalStore in React

try {
  await session.open(file, { onProgress: showProgress });

  // Cut the first second, and fade the rest in over half a second.
  const { plan } = session.getSnapshot();
  const rate = plan?.sampleRate ?? 48_000;
  session.execute({ type: "audio.deleteRange", start: 0, end: rate, newKey: session.createKey() });
  const [clip] = session.getSnapshot().plan?.clips ?? [];
  if (clip) {
    session.execute({ type: "audio.setFade", key: clip.key, edge: "in", frames: rate / 2, curve: "equalPower" });
  }
  session.execute({ type: "audio.setMetadata", field: "title", value: "Interview" });
  session.undo(); // and session.redo()

  const wav = await session.export({
    format: { container: "wav", sampleFormat: "pcm24" },
    onProgress: showProgress,
  });
  offerDownload(wav); // a Blob: the session never downloads anything itself
} catch (error) {
  showError(messages.error(error)); // text by code, never the error's message
}
```

- **The snapshot** has the `plan` (clips in frames, and the metadata), the `sources`, `canUndo` and `canRedo`, `busy`, the last `error`, and `warnings`: limits past their warning thresholds, and `truncated` for a WAV or AIFF file cut short, which opens with the audio it holds. Show their text from `warnings.<name>` in `audioMessages`.
- **Commands** are plain data, such as `audio.splitClip` or `audio.setGain`, with an exact inverse for undo. One that doesn't apply throws `INVALID_COMMAND` with a stable `details.reason`, such as `unknown-clip`. `session.group(fn)` makes several commands, such as a drag, one undo step.
- **`session.insert(file, { at })`** adds another recording at a frame, as one undo step. It must have the session's sample rate, for now.
- **Exports** render the plan as it is when the export starts, as 16-bit (the default) or 24-bit PCM, or 32-bit float WAV, with the metadata in the file. They run under `maxProcessingTime`, and the `signal` option cancels them.
- **Plans are portable JSON:** `toAudioPlanDocument` and `readAudioPlanDocument` write and read the `hm-audio-plan` format, whose JSON Schema ships in the package, at `@hussmartinez/audio-sdk/formats/hm-audio-plan/v1.schema.json` ([format record](docs/formats/hm-audio-plan.md)).

## Using the engine directly

The session uses the engine for you. Use it directly for a custom pipeline: `createAudioEngine()` probes a file in a Web Worker, which reads its headers and walks its frames to bound how much audio it can decode to. Check that against your file policy, then decode it and build its waveform overview:

```ts
import {
  audioLimits,
  audioMessages,
  createAudioEngine,
  isAudioError,
} from "@hussmartinez/audio-sdk";
import { checkFile, createMessages, withProcessingTime } from "@hussmartinez/sdk-core";

const policy = audioLimits.resolve({ maxDuration: 30 * 60 * 1_000 }); // or {} for the defaults
const engine = createAudioEngine();
const messages = createMessages(audioMessages, { locale: navigator.language });

try {
  checkFile(policy, file); // the size, before anything is read
  const probe = await engine.probe(file);
  // The bound, never a length a header declares (docs/adr/0004).
  policy.check("maxChannels", probe.channels);
  policy.check("maxSampleRate", probe.sampleRate);
  policy.check("maxDuration", (probe.frameBound / probe.sampleRate) * 1_000);
  policy.check("maxDecodedSize", probe.frameBound * probe.channels * 4);

  const audio = await withProcessingTime(policy, (signal) =>
    engine.decode(file, probe, { signal, onProgress: (fraction) => showProgress(fraction) }),
  );
  const peaks = await engine.peaks(audio);
  // audio is an AudioBuffer at the file's own sample rate.
} catch (error) {
  showError(messages.error(error)); // text by code, never the error's message
  if (isAudioError(error, "DECODE_FAILED")) suggestConvertingToWav();
}
```

`check` returns `"warning"` from a limit's warning threshold, so you can tell people that a long file may be slow. `withProcessingTime` applies `maxProcessingTime`: when it runs out, the engine stops waiting at once and rejects with `PROCESSING_TIME_EXCEEDED`, even if the browser's decoder never finishes (sdk-core [ADR 0031](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0031-platform-decoders-on-the-page.md)).

### Formats

| Container | Codecs | Decoded by |
|---|---|---|
| WAV (RIFF, RF64) | PCM 8 to 32-bit, float 32 and 64-bit, plain and extensible | the SDK, in its worker |
| AIFF, AIFC | PCM 8 to 32-bit, big and little-endian, float 32 and 64-bit | the SDK, in its worker |
| FLAC | FLAC | the browser |
| MP3 | MPEG-1, 2 and 2.5, layers I to III; not free format | the browser |
| ADTS | AAC, including HE-AAC | the browser |
| MP4, M4A | AAC or ALAC, one audio track; not fragmented | the browser |
| Ogg | Opus, Vorbis or FLAC, one stream | the browser |
| WebM, Matroska | Opus, Vorbis, FLAC or AAC, one audio track, other tracks ignored | the browser |

**Compressed formats decode with the browser's own decoders**, on the page, so which of them open varies by browser: a file the browser can't decode fails with `DECODE_FAILED`. [`docs/capabilities.md`](docs/capabilities.md) shows which decode in Chromium, Firefox and WebKit, measured by the end-to-end suite. Before any decoder sees a file, the SDK's own readers bound it from its frames or packets, and refuse what they can't bound. [ADR 0001](docs/adr/0001-audio-engines.md) has the rules for each format.

### Worker and Content Security Policy

| Mode | How | Directives |
|---|---|---|
| Inline (the default) | `createAudioEngine()` and `createAudioProcessor()`: the worker is inlined and starts from a `blob:` URL | `worker-src blob:` |
| Self-hosted | `createAudioEngine({ assetsUrl: "/audio-sdk/" })`, and the same option for `createAudioProcessor`: serve the package's `dist/assets/` there; the worker is `audio/audio.worker.js` | `worker-src 'self'` |

Neither mode needs `'unsafe-eval'` or `'wasm-unsafe-eval'`, and the SDK makes no network requests of its own ([ADR 0002](docs/adr/0002-workers-and-assets.md)).

**Copy `dist/assets` again after every upgrade.** A self-hosted worker from another version of the SDK is refused with `WORKER_START_FAILED`, whose `details` name the file and both versions.

### Errors

Every failure is an `AudioError` with a stable `code` and structured `details`; `isAudioError(error, code)` checks one, across workers and copies of the package. Show people the text for the code from `audioMessages` through `createMessages`, never `error.message`. The codes are:

| Code | When |
|---|---|
| `INVALID_AUDIO` | A file is malformed, its headers claim more than its frames carry, or it decodes to more than its bound |
| `UNSUPPORTED_FORMAT` | A container, codec or layout the SDK doesn't read, or a file it can't bound |
| `DECODE_FAILED` | The browser couldn't decode a file the SDK probed, or decoded no audio from it |
| `FILE_TOO_LARGE`, `DECODED_SIZE_TOO_LARGE`, `DURATION_TOO_LONG`, `TOO_MANY_CHANNELS`, `SAMPLE_RATE_TOO_HIGH` | A file exceeds a limit; `details` name it, with its maximum and the actual value ([ADR 0004](docs/adr/0004-audio-limits.md)) |
| `PROCESSING_TIME_EXCEEDED` | `maxProcessingTime` ran out |
| `ABORTED`, `TIMEOUT` | The call's `signal` aborted |
| `UNSUPPORTED_ENVIRONMENT` | The browser lacks a feature, such as Web Audio, which `details.feature` names |
| `WORKER_START_FAILED`, `WORKER_CRASHED` and other `WORKER_*` codes | The worker couldn't start, stopped unexpectedly, or is from another version |

The session adds:

| Code | When |
|---|---|
| `TOO_MANY_FILES`, `SESSION_TOO_LARGE`, `TOO_MANY_CLIPS` | An insert or an edit would exceed `maxFiles`, `maxSessionSize` or `maxClips` |
| `INVALID_COMMAND` | A command doesn't apply, or there's nothing to export; `details.reason` says why |
| `INVALID_DOCUMENT` | A plan document isn't valid; `details.reason` says why. Another format or a later version is `UNSUPPORTED_FORMAT` |

## Development

The repository root is the published package, laid out as in the family's [standard layout](https://github.com/ie-huss-martinez/sdk-core/blob/main/STANDARDS.md#repository-layout): the source is in [`src`](src), and the pnpm workspace adds [`examples/`](examples), which consume the built package as hosts do, and [`e2e/`](e2e), the end-to-end suite.

You need Node 24 (see [`.node-version`](.node-version)) and pnpm. The exact pnpm version is pinned in `package.json`, and pnpm switches to it automatically.

```sh
pnpm install       # also installs the git hooks
pnpm verify        # everything CI runs
pnpm verify:fast   # the subset the pre-push hook runs
```

Browser tests need Playwright's browsers once: `pnpm exec playwright install chromium`, plus `firefox webkit` to run all three engines with `CI=1` or `pnpm test:browser:all`.

`pnpm verify` runs, in order:

| Step | Script | Tool |
|---|---|---|
| Format and lint | `lint` | Biome |
| CSS rules | `lint:css` | stylelint, with the `hm-` namespace and token rules |
| Types | `typecheck` | TypeScript |
| Dependency rules | `lint:deps` | dependency-cruiser, through `hm-lint-deps` |
| Build | `build` | Vite, then api-extractor for the type declarations |
| Unit tests | `test` | Vitest |
| Browser tests | `test:browser` | Vitest in Chromium, and in Firefox and WebKit too in CI |
| Examples | `build:examples` | Vite, building `examples/vite` against the built package |
| End-to-end tests | `test:e2e` | Playwright against the built example: the [codec capability matrix](docs/capabilities.md), no requests to other origins, and the self-hosted worker under a strict Content Security Policy |
| Size budgets | `check:size` | size-limit, brotli size of each entry point |
| API reports | `check:api` | api-extractor, one report per entry point in [`api`](api) |
| Package checks | `check:package` | publint and Are the Types Wrong? |

The configuration extends the shared presets in [`@hussmartinez/sdk-config`](https://www.npmjs.com/package/@hussmartinez/sdk-config). The git hooks ([ADR 0016](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0016-git-hooks-and-merge-guards.md)) run automatically: a secret scan and lint of staged files on commit, a Conventional Commits check of the message, and `pnpm verify:fast` on push.

When a change alters the public API on purpose, update the reports with `pnpm api:update` and commit them.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request. Coding agents also start with [`AGENTS.md`](AGENTS.md). Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately, as described in the [security policy](SECURITY.md).

## License

[Apache-2.0](LICENSE)
