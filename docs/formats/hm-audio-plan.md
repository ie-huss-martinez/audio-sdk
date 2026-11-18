# `hm-audio-plan` and `hm-audio-command`

audio-sdk's portable formats ([sdk-core ADR 0045](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0045-portable-formats-and-conformance-vectors.md)). A port in another language reads and writes them, and proves it applies commands and mixes as this SDK does by passing the vectors in [`conformance/`](../../conformance).

| Format | Schema | What it holds |
|---|---|---|
| `hm-audio-plan` 2 | [`formats/hm-audio-plan/v2.schema.json`](../../formats/hm-audio-plan/v2.schema.json) | A multitrack plan ([ADR 0006](../adr/0006-multitrack.md)), with the sources its clips use |
| `hm-audio-command` 2 | [`formats/hm-audio-command/v2.schema.json`](../../formats/hm-audio-command/v2.schema.json) | One user-level edit command |
| `hm-audio-plan` 1 | [`formats/hm-audio-plan/v1.schema.json`](../../formats/hm-audio-plan/v1.schema.json) | One track of clips played back to back ([ADR 0003](../adr/0003-clip-plan-document-model.md)). Read by migrating it; never written |
| `hm-audio-command` 1 | [`formats/hm-audio-command/v1.schema.json`](../../formats/hm-audio-command/v1.schema.json) | A version 1 command. Migrated to version 2's |

The package writes version 2 and reads both: `readAudioPlanDocument(json)` returns a version 2 plan from a document of either version, `toAudioPlanDocument(plan, sources)` writes version 2, and `migrateAudioCommand(command, plan)` turns a version 1 command into version 2's. A later version is refused with `UNSUPPORTED_FORMAT`.

## Loading the schemas

The schemas ship with the package, under `@hussmartinez/audio-sdk/formats/`, so a host validates against the version that matches its installed reader. `readAudioPlanDocument` already checks everything the schema does and more, so a host needs the schema only to validate elsewhere, such as on a server that stores documents, or in another tool.

```ts
import { Ajv2020 } from "ajv/dist/2020.js";
import planSchema from "@hussmartinez/audio-sdk/formats/hm-audio-plan/v2.schema.json" with { type: "json" };
import commandSchema from "@hussmartinez/audio-sdk/formats/hm-audio-command/v2.schema.json" with { type: "json" };

const ajv = new Ajv2020({ strict: true });
// The command schema refers to the plan schema's definitions by its $id, so add that first.
const isPlan = ajv.compile(planSchema);
const isCommand = ajv.compile(commandSchema);

if (!isPlan(JSON.parse(text))) console.error(isPlan.errors);
```

In Node without a bundler, `createRequire(import.meta.url).resolve("@hussmartinez/audio-sdk/formats/hm-audio-plan/v2.schema.json")` gives the file's path. The vectors in `conformance/` stay in the repository: they're for ports and the SDK's own tests.

## `hm-audio-plan`, version 2

```json
{
  "format": "hm-audio-plan",
  "version": 2,
  "sampleRate": 48000,
  "channels": 2,
  "gainDb": -1.5,
  "sources": { "s1": { "frames": 1000 }, "s2": { "frames": 500 } },
  "tracks": [
    {
      "key": "voice",
      "name": "Voice",
      "gainDb": 0,
      "muted": false,
      "soloed": false,
      "clips": [
        {
          "key": "a",
          "at": 0,
          "source": "s1",
          "start": 0,
          "end": 100,
          "gainDb": 0,
          "fadeIn": { "frames": 0, "curve": "linear" },
          "fadeOut": { "frames": 0, "curve": "linear" }
        }
      ]
    },
    { "key": "music", "name": "", "gainDb": -6, "muted": false, "soloed": false, "clips": [] }
  ],
  "metadata": { "title": "Take 1", "artist": "", "album": "", "year": "", "comment": "" }
}
```

- **A clip's `at`** is the timeline frame it starts on. A track's clips are listed in time order, and each ends at or before the next one starts.
- **Keys** are unique across tracks and clips together: no clip has a track's key.
- **Gains** are copied floats at three levels, the clip's, the track's and the plan's `gainDb`, each from −120 to 120.
- **A track's `name`** has at most 100 code points. Empty means it has none. It's untrusted text: show it as text, never as HTML.
- **A plan has at least one track.** A track may have no clips.
- **Beyond the schema,** a reader checks that every clip lies within a source the document lists, that its fades fit it, that each track is in time order without overlap, and that keys are unique.
- **Numbers:** every position and length is a whole number of frames at `sampleRate`. The gains are the only floats. They're copied, never computed, so they compare exactly (ADR 0045, section 3).
- **Sources** are keyed by the ids the clips use, which only mean something within the document. Each gives its length in frames. Once documents travel with their files, it also gives an `asset`: the SHA-256 of the bytes, their media type and their size. A document never inlines audio.
- **Lengths are in Unicode code points,** as the schema's `maxLength` counts them: a metadata value has at most 1,000 and a track's name at most 100, so 100 emoji fit in a name, though they're 200 UTF-16 units (ADR 0045, section 8).
- **Strict:** an unknown field anywhere is refused, never dropped. So a later version's document can't be misread as this one.

## `hm-audio-command`, version 2

Clip edits never move another clip, and fail with `clips-overlap` rather than push one. Time edits add or remove time on the tracks they name, and move everything after it on those tracks.

| Command | Does |
|---|---|
| `audio.insertClips { track, clips }` | Adds clips to a track, each at its own `at`, in free space |
| `audio.removeClips { keys }` | Removes clips on any tracks, leaving silence |
| `audio.trimClip { key, start, end }` | Changes the source range a clip plays. The audio stays where it is: moving `start` moves `at` by as much |
| `audio.splitClip { key, at, newKey }` | Splits a clip at a timeline frame strictly inside it |
| `audio.moveClips { keys, by, track? }` | Moves clips by a signed number of frames, and to one track when it's named |
| `audio.setGain`, `audio.setFade`, `audio.setMetadata` | As in version 1 |
| `audio.deleteRange { start, end, tracks, ripple, newKeys? }` | Removes a range of time from the named tracks. With `ripple`, later clips on those tracks move earlier by its length |
| `audio.keepRange { start, end }` | Removes everything outside a range, on every track, and moves what's kept to the start |
| `audio.insertTime { at, frames, tracks, newKeys? }` | Opens silence on the named tracks, splitting a clip that lies across the frame |
| `audio.addTrack { key, index, name? }` | Adds an empty track |
| `audio.removeTracks { keys }` | Removes tracks with their clips; never the last one |
| `audio.moveTrack { key, to }` | Moves a track to an index of the result |
| `audio.setTrack { key, name?, gainDb?, muted?, soloed? }` | Sets the fields given, at least one |
| `audio.setMasterGain { gainDb }`, `audio.setChannels { channels }` | Set the plan's gain and channel count |

- **`newKeys` is an object, by track key:** the key of the part a cut leaves after it, on a track where a range lies inside one clip, or a frame inside one. A track that doesn't need its key ignores it, so a caller can always send one for every track. A key for a track the command doesn't name is `unknown-track`.
- **What a schema states is checked first,** such as a gain's range or a name's length, then what depends on the plan. So a command the schema refuses is refused by the reducer for the schema's reason.
- **Version 1's `audio.moveClips { keys, to }` and `audio.reorderClips` are gone:** with positions, order follows time.
- **The commands undo runs** are internal and aren't part of the format: `audio.restoreClips`, `audio.updateClips`, `audio.placeClips`, `audio.replaceClips` and `audio.restoreTracks`. The reducer refuses unknown fields in every command.

## Mixing

Playback and export follow one definition ([ADR 0006](../adr/0006-multitrack.md)):

> `out[frame] = clamp(master × Σ over audible tracks (track gain × clip's gainAt × the clip's source frame, mixed to the plan's channels))`

- **Audible** tracks are those that aren't muted and, when any track is soloed, are soloed themselves. Mute wins over solo.
- **Gains** are `10^(dB / 20)`. A clip's `gainAt` is its gain times its fades: a fade in starts at silence on the clip's first frame, and a fade out reaches silence on its last; `linear` changes at a constant rate, and `equalPower` follows a quarter sine.
- **Channels** mix by the Web Audio specification's speaker rules for mono, stereo, quad and 5.1, and channel by channel otherwise.
- **Tracks sum at unity,** in plan order. Nothing is scaled by the number of tracks, limited or normalised.
- **The mix is as long as the last audible clip,** so a muted track neither sounds nor pads it.
- **Clamping** is to full scale, from −1 to 1. An export also gives the mix's peak before clamping and how many frames were clamped.

## Version 1

Version 1 held one list of clips, played back to back, with no positions:

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

Its commands were `audio.insertClips { at, clips, splitKey? }`, `audio.removeClips { keys }`, `audio.deleteRange { start, end, newKey? }`, `audio.trimClip`, `audio.splitClip`, `audio.moveClips { keys, to }`, `audio.setGain`, `audio.setFade` and `audio.setMetadata`. Each closed the gap it left, because a clip's place was the sum of the lengths before it. The package no longer runs them; its tests keep version 1's reducer as the reference that the migration is checked against.

### Migrating from version 1

- **A plan:** one track, keyed `t1`, unnamed, at 0 dB, not muted or soloed, holding the clips back to back from frame 0, under a master gain of 0 dB. If a clip is keyed `t1`, the track takes the first of `t2`, `t3` and so on that no clip has. A version 2 reader does this to a version 1 document.
- **A command** means something only on a version 1 plan, so it migrates on the plan that plan migrated to, to these version 2 commands on its one track, run in order as one undo step. Version 1's commands closed gaps as they went; `open` below is `audio.insertTime`, and `close` is `audio.deleteRange` with `ripple`.

  | Version 1 | Version 2, in order |
  |---|---|
  | `audio.insertClips { at, clips, splitKey }` | `open` the clips' total length at `at`, with `splitKey` as the track's new key; then `audio.insertClips` with the clips back to back from `at` |
  | `audio.removeClips { keys }` | For each clip, from the last in time to the first: `close` the range it covers |
  | `audio.deleteRange { start, end, newKey }` | `close` the range, with `newKey` as the track's new key |
  | `audio.trimClip { key, start, end }` | `open` room before the clip by how much its start moves earlier, and after it by how much its end moves later; then `audio.trimClip`; then `close` the gap before it by how much its start moved later, and after it by how much its end moved earlier. Nothing opens or closes after the last clip |
  | `audio.moveClips { keys, to }` | `close` each moved clip's range, from the last to the first; `open` their total length where the `to`-th remaining clip starts; then `audio.insertClips` with them back to back there |
  | `audio.splitClip`, `audio.setGain`, `audio.setFade`, `audio.setMetadata` | The same command |

  A command that names a clip the plan doesn't have, or an index past the end, is refused by the migration with `INVALID_COMMAND`. Any other invalid command migrates to commands the reducer refuses, and the refusal is the first one met in that order.

## Rejections

A refusal is compared by its code and `details.reason`, never its message:

| Code | Reasons |
|---|---|
| `UNSUPPORTED_FORMAT` | `unknown-format`, `unknown-format-version` |
| `INVALID_DOCUMENT` | `malformed-document`, `unknown-source`, `duplicate-key`, `clips-overlap`, `clips-out-of-order`, `no-tracks`, `invalid-fade-curve`, `metadata-too-long`, `name-too-long`, and a clip's own problems: `invalid-frames`, `clip-too-short`, `clip-outside-source`, `gain-out-of-range`, `fades-too-long` |
| `INVALID_COMMAND` | `AudioCommandRejection`'s tokens, such as `unknown-clip`, `unknown-track`, `key-taken`, `clips-overlap`, `frame-outside-plan` or `last-track` |

## The vectors

| File | Subject | A case's input | Its expected result |
|---|---|---|---|
| [`conformance/hm-audio-plan-2.json`](../../conformance/hm-audio-plan-2.json) | `hm-audio-plan-2` | A document of version 1 or 2 | The version 2 document a reader writes back, or the rejection |
| [`conformance/hm-audio-commands-2.json`](../../conformance/hm-audio-commands-2.json) | `hm-audio-commands-2` | `{ plan, command }`, both version 2 | The resulting document, or the rejection. The command's inverse must also restore the plan |
| [`conformance/hm-audio-command-migration.json`](../../conformance/hm-audio-command-migration.json) | `hm-audio-command-migration` | `{ plan, command }`, both version 1 | The version 2 document after migrating both and applying the commands, or the first rejection. The migrated commands aren't compared, only what they do |
| [`conformance/hm-audio-mix.json`](../../conformance/hm-audio-mix.json) | `hm-audio-mix` | `{ plan, sources }`: a version 2 document, and each source's samples, one list per channel | `{ channels, peak, clipped }`: the mix, clamped; its largest absolute sample before clamping, where 1 is full scale; and the frames clamped. Every number within the case's `tolerance`, because gains and fades are computed |
| [`conformance/hm-audio-plan.json`](../../conformance/hm-audio-plan.json) | `hm-audio-plan` | A version 1 document | The version 1 document a version 1 reader writes back, or the rejection |
| [`conformance/hm-audio-commands.json`](../../conformance/hm-audio-commands.json) | `hm-audio-commands` | `{ plan, command }`, both version 1 | The resulting version 1 document, or the rejection, by version 1's reducer |

Hand-written cases cover every outcome. Generated ones come from the reducers' property-test generators, with a fixed seed. `pnpm conformance:update` rewrites the files, and the tests fail when the checked-in files differ from what the generators write.

The last two files are version 1's own. They run against version 1's reducer and writer, which live in the repository's tests, in `test/v1/`, and they're what a port needs only if it wants to check a version 1 implementation of its own. A version 2 port needs the first four.

The TypeScript tests also check that the schemas agree with the readers. Every document and command the vectors accept passes its schema, and every structural refusal fails it. Over thousands of mutated inputs, the reducers and the readers never accept anything their schema refuses.

## Changing the formats

A breaking change is a new version, with its schema beside the others and a migration from the version before (ADR 0045, section 1). A reader refuses a later version with `UNSUPPORTED_FORMAT` and `unknown-format-version`.
