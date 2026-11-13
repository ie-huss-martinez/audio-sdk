# `hm-audio-plan` and `hm-audio-command`, version 1

audio-sdk's portable formats ([sdk-core ADR 0045](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0045-portable-formats-and-conformance-vectors.md)). A port in another language reads and writes them, and proves it applies commands as this SDK does by passing the vectors in [`conformance/`](../../conformance).

| Format | Schema | What it holds |
|---|---|---|
| `hm-audio-plan` 1 | [`formats/hm-audio-plan/v1.schema.json`](../../formats/hm-audio-plan/v1.schema.json) | A clip plan ([ADR 0003](../adr/0003-clip-plan-document-model.md)), with the sources its clips use |
| `hm-audio-command` 1 | [`formats/hm-audio-command/v1.schema.json`](../../formats/hm-audio-command/v1.schema.json) | One user-level edit command |

## Loading the schemas

The schemas ship with the package, under `@hussmartinez/audio-sdk/formats/`, so a host validates against the version that matches its installed reader. `readAudioPlanDocument` already checks everything the schema does and more, so a host needs the schema only to validate elsewhere, such as on a server that stores documents, or in another tool.

```ts
import { Ajv2020 } from "ajv/dist/2020.js";
import planSchema from "@hussmartinez/audio-sdk/formats/hm-audio-plan/v1.schema.json" with { type: "json" };
import commandSchema from "@hussmartinez/audio-sdk/formats/hm-audio-command/v1.schema.json" with { type: "json" };

const ajv = new Ajv2020({ strict: true });
// The command schema refers to the plan schema's definitions by its $id, so add that first.
const isPlan = ajv.compile(planSchema);
const isCommand = ajv.compile(commandSchema);

if (!isPlan(JSON.parse(text))) console.error(isPlan.errors);
```

In Node without a bundler, `createRequire(import.meta.url).resolve("@hussmartinez/audio-sdk/formats/hm-audio-plan/v1.schema.json")` gives the file's path. The vectors in `conformance/` stay in the repository: they're for ports and the SDK's own tests.

## `hm-audio-plan`

```json
{
  "format": "hm-audio-plan",
  "version": 1,
  "sampleRate": 48000,
  "channels": 2,
  "sources": { "s1": { "frames": 1000 } },
  "clips": [
    {
      "key": "a",
      "source": "s1",
      "start": 0,
      "end": 100,
      "gainDb": -3.5,
      "fadeIn": { "frames": 20, "curve": "equalPower" },
      "fadeOut": { "frames": 0, "curve": "linear" }
    }
  ],
  "metadata": { "title": "Take 1", "artist": "", "album": "", "year": "", "comment": "" }
}
```

- **Numbers:** every position and length is a whole number of frames at `sampleRate`. `gainDb` is the one float. It's copied, never computed, so it compares exactly (ADR 0045, section 3).
- **Sources** are keyed by the ids the clips use, which only mean something within the document. Each gives its length in frames. Once documents travel with their files, it also gives an `asset`: the SHA-256 of the bytes, their media type and their size. A document never inlines audio.
- **Beyond the schema,** a reader checks what depends on the whole document: every clip lies within a source the document lists, its fades fit it together, and keys are unique.
- **Strict:** an unknown field anywhere is refused, never dropped. So a later version's document can't be misread as this one.

`readAudioPlanDocument(json)` reads a document, and `toAudioPlanDocument(plan, sources)` writes one.

## `hm-audio-command`

The edits a user makes: `audio.insertClips`, `audio.removeClips`, `audio.deleteRange`, `audio.trimClip`, `audio.splitClip`, `audio.moveClips`, `audio.setGain`, `audio.setFade` and `audio.setMetadata`, as [ADR 0003](../adr/0003-clip-plan-document-model.md) describes them. The commands undo runs, such as `audio.restoreClips`, are internal and aren't part of the format. The reducer refuses unknown fields here too.

## Rejections

A refusal is compared by its code and `details.reason`, never its message:

| Code | Reasons |
|---|---|
| `UNSUPPORTED_FORMAT` | `unknown-format`, `unknown-format-version` |
| `INVALID_DOCUMENT` | `malformed-document`, `unknown-source`, `duplicate-key`, `invalid-fade-curve`, `metadata-too-long`, and a clip's own problems: `invalid-frames`, `clip-too-short`, `clip-outside-source`, `gain-out-of-range`, `fades-too-long` |
| `INVALID_COMMAND` | `AudioCommandRejection`'s tokens, such as `unknown-clip`, `key-taken` or `frame-outside-plan` |

## The vectors

| File | Subject | A case's input | Its expected result |
|---|---|---|---|
| [`conformance/hm-audio-plan.json`](../../conformance/hm-audio-plan.json) | `hm-audio-plan` | A document | The document as a reader writes it back, or the rejection |
| [`conformance/hm-audio-commands.json`](../../conformance/hm-audio-commands.json) | `hm-audio-commands` | `{ plan, command }` | The resulting document, or the rejection. The command's inverse must also restore the plan |

Hand-written cases cover every outcome. Generated ones come from the reducer's property-test generators, with a fixed seed: up to 60 commands that apply, and two of each refusal. `pnpm conformance:update` rewrites the files, and the tests fail when the checked-in files differ from what the generator writes.

The TypeScript tests also check that the schemas agree with the readers. Every document and command the vectors accept passes its schema, and every structural refusal fails it. Over thousands of mutated inputs, the reducer and the reader never accept anything their schema refuses.

## Changing the formats

A breaking change is a new version, with its schema beside this one and a migration from version 1 (ADR 0045, section 1). A reader refuses a later version with `UNSUPPORTED_FORMAT` and `unknown-format-version`.
