# 0006. Multitrack: tracks of positioned clips, mixed on playback and export

- **Status:** Accepted. The editor's timeline depends on an amendment to [ui ADR 0011](https://github.com/ie-huss-martinez/ui/blob/main/docs/adr/0011-timeline.md), below; the headless core doesn't
- **Date:** 2026-11-18
- **Amended:** 2026-11-18, with the review's rulings: Ripple shows the tracks it will move, the model's step is two pull requests, and `ui`'s amendment is designed with video-sdk's needs.
- **Amended:** 2026-11-18, with resampling as built: the SDK's own windowed sinc in the worker, not an `OfflineAudioContext`.
- **Amended:** 2026-11-18, with the model as built: `newKeys` is an object by track key, `audio.keepRange` needs no keys, a command's schema-stated rules are checked first, and how version 1's commands migrate.
- **Amended:** 2026-11-18, with the switch as built: an export is as long as its last audible clip, version 1's reducer is kept in the tests as the reference, and the mix's definition is two pure functions in the core.
- **Amended:** 2026-11-18, with playback's levels as built: every track with clips is scheduled, muted or not, and a plan with the same clips changes only levels.
- **Supersedes in part:** [ADR 0003](0003-clip-plan-document-model.md) (the plan's shape, derived positions, the command table and version 1 of the formats) and [ADR 0005](0005-editor-shell.md) (the timeline, the selection and the order of the work). **Extends:** [ADR 0004](0004-audio-limits.md), with two limits.

## Context

The product decision of 2026-11-18 is that the audio editor is **multitrack**: several tracks layered on one timeline, such as voice, music and effects, each with its own gain, mute and solo, and clips positioned in time, mixed on export.

What exists was built for one track:

- **The plan** ([ADR 0003](0003-clip-plan-document-model.md)) is one list of clips played back to back. A clip's place is derived from the clips before it. ADR 0003 named multitrack as an extension: clips would get a timeline position, and overlapping clips would mix.
- **The formats** `hm-audio-plan` and `hm-audio-command` are at version 1, and [sdk-core ADR 0045](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0045-portable-formats-and-conformance-vectors.md) requires a breaking change to bump the version and ship a migration.
- **A source at another sample rate can't be inserted yet:** ADR 0003 planned resampling, and the insert fails with `UNSUPPORTED_FORMAT` until it's built. With one track that was rare. With voice at 48 kHz and music at 44.1 kHz, it's the normal case.
- **The editor isn't built.** [ADR 0005](0005-editor-shell.md) designed it for one track, and planned to build its own timeline if `ui`'s wasn't ready. `ui` 0.11.0 now ships `Timeline`, `TimelinePlayhead`, `TimelineLayer` and `TimelineClips` ([ui ADR 0011](https://github.com/ie-huss-martinez/ui/blob/main/docs/adr/0011-timeline.md)), and the `hm-text` class ([ui ADR 0010](https://github.com/ie-huss-martinez/ui/blob/main/docs/adr/0010-opt-in-text-root.md)). Its clip track lays clips out back to back in one lane, and it requires an SDK that renders it to offer zoom buttons and buttons that move and trim.
- **The audio-editor app** runs on 0.5.0's headless session with a temporary editor of its own, and its author reported fifteen points of friction in the API ([#54](https://github.com/ie-huss-martinez/audio-sdk/issues/54)).

Nothing has been released with an editor, and the only known consumer is that app, so this is the cheapest moment to change the model.

## Decision

### The model

The plan becomes a list of tracks:

```ts
interface AudioPlan {
  sampleRate: number;
  channels: number;
  gainDb: number;          // the master gain
  tracks: AudioTrack[];    // top to bottom; at least one
  metadata: AudioMetadata;
}

interface AudioTrack {
  key: string;
  name: string;            // at most 100 code points; "" shows "Track 2"
  gainDb: number;
  muted: boolean;
  soloed: boolean;
  clips: AudioClip[];      // in time order, never overlapping
}

interface AudioClip {
  key: string;
  at: number;              // the timeline frame the clip starts on
  source: string; start: number; end: number;
  gainDb: number; fadeIn: AudioFade; fadeOut: AudioFade;
}
```

- **A clip's position is stored, as `at`.** This replaces ADR 0003's rule that positions are derived and never stored. That rule made disagreement impossible on one track; with silence between clips and tracks that must stay in step, a stored position is what lets an edit on one track leave every other clip where it is. What the rule protected is now an invariant that the reducer and the document reader both check: within a track, clips are sorted by `at` and don't overlap, so each clip ends at or before the next one starts.
- **Clips on one track never overlap.** Two sounds at once are two tracks. So a track plays at most one clip at any frame, the track's listbox order is its time order, and a crossfade is two tracks with a fade each.
- **The plan's length** is the end of its last clip on any track. Silence before the first clip is part of the plan.
- **Keys:** track and clip keys share one namespace, from `session.createKey()`, and each is unique in the plan.
- **Mute and solo are part of the plan,** changed by commands and undone like any edit, because they change what's exported. A track is **audible** when it isn't muted and either no track is soloed or it is: `audibleTracks(plan)` is the one definition, used by playback, export and the editor's dimming of silent tracks.
- **Gains** are in decibels, from −120 to +120, at three levels: clip, track and master. All three are copied floats, never computed, so documents compare exactly.
- **Track names are untrusted text.** They come from users and from stored documents. The editor renders them as text inside `<bdi>`, never as HTML. An empty name shows the catalogue's "Track 2". The session never copies a file's name into the plan, because documents carry names only by opt-in ([sdk-core ADR 0045](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0045-portable-formats-and-conformance-vectors.md), section 2).
- **Sample rate:** still the first source's. A source at another rate is resampled to it when it's inserted, as ADR 0003 planned. Limits are checked against the resampled size before decoding.
  - **The resampler is the SDK's own:** a windowed sinc, in the worker, block by block. ADR 0003 planned an `OfflineAudioContext`. But the browsers' resamplers differ from each other, an offline render can't report progress or be stopped, and it runs on the page. Ours gives the same samples in every engine and however the blocks are cut, so tests can assert samples, and a port can match them within a tolerance.
  - **The engine does it, when asked:** `AudioEngine.decode` takes the rate to return, and the session asks for its own. A source converted this way says so in `resampledFrom`.
  - **Its quality is fixed:** 16 zero crossings a side under a Kaiser window, about 90 dB down in the stop band, passing 94.5% of the band below the lower Nyquist frequency. It takes about 4 ms for each second of each channel on a desktop.
- **Channels:** still set from the first source, but an insert with more channels than the plan raises the plan's count to the source's, in the same undo step, up to `maxChannels`. It never lowers it. Otherwise a mono voice opened first would fold stereo music to mono. Raising is transparent: mono plays equally on both channels, by the speaker rules ADR 0003 chose.

### The formats: version 2

Both formats go to version 2, by sdk-core ADR 0045's rules. Version 1 has `clips` at the top level and no `at`; version 2 has `tracks`. A strict version 1 reader refuses a version 2 document, as it should.

- **Schemas:** `formats/hm-audio-plan/v2.schema.json` and `formats/hm-audio-command/v2.schema.json`, beside version 1's, which stay in the package.
- **Reading version 1 plans:** `readAudioPlanDocument` accepts both versions and returns a version 2 plan. The migration is pure and total: one track with the key `t1`, an empty name, 0 dB, not muted or soloed; each clip's `at` is the sum of the lengths before it; the master gain is 0 dB. If a clip already has the key `t1`, the track takes the first free `t2`, `t3`, and so on.
- **Reading version 1 commands:** a version 1 command only means something on a version 1 plan, so `migrateAudioCommand(command, plan)` takes the migrated plan and returns the version 2 commands with the same effect. Version 1's commands closed gaps as they went; the mapping uses the time commands below to do the same, such as `audio.insertTime` then `audio.insertClips` for a version 1 insert, and returns the commands to run as one undo step. [The format record](../formats/hm-audio-plan.md) lists the mapping for each command, and its order is part of the format: a refusal is the first one met.
- **Writing:** `toAudioPlanDocument` writes version 2 only.
- **New rejection reasons:** `clips-overlap`, `clips-out-of-order`, `no-tracks`, `unknown-track`, `last-track`, `name-too-long` and `nothing-audible`, with the existing ones. Tokens never change meaning once released.
- **Vectors:** `conformance/` gains version 2 cases for plans and commands, cases that migrate version 1 documents and commands, and a new subject, `hm-audio-mix`: a small plan over short sources given as numbers, and the expected samples with a stated `tolerance`, because gains from decibels and fade curves are computed floats (ADR 0045, section 3). The version 1 vectors stay as they were. They run against version 1's reducer and writer, which the package no longer ships and the tests keep, in `test/v1/`, as the reference that the migration is checked against.

### Commands

Edits come in two kinds, and the difference is the point of the design:

- **Clip edits never move another clip.** They fail with `clips-overlap` rather than push a neighbour.
- **Time edits add or remove time on the tracks they name,** and move everything after it on those tracks. Closing a gap is always asked for, never a side effect.

| Command | Changes | Inverse |
|---|---|---|
| `audio.insertClips { track, clips }` | Adds clips to a track, each at its own `at`, in free space | `audio.removeClips` |
| `audio.removeClips { keys }` | Removes clips, on any tracks, leaving silence | `audio.restoreClips` |
| `audio.trimClip { key, start, end }` | Changes the source range a clip plays. The audio stays where it is on the timeline: moving `start` moves `at` by the same amount | `audio.updateClips` |
| `audio.splitClip { key, at, newKey }` | Splits a clip at a timeline frame strictly inside it | `audio.replaceClips` |
| `audio.moveClips { keys, by, track? }` | Moves clips by a signed number of frames, and to another track if one is named | `audio.placeClips` |
| `audio.setGain { keys, gainDb }`, `audio.setFade { key, edge, frames, curve }` | As in ADR 0003 | `audio.updateClips` |
| `audio.deleteRange { start, end, tracks, ripple, newKeys? }` | Removes a range of time from the named tracks, trimming the clips at its edges. With `ripple`, later clips on those tracks move earlier by its length; without, silence stays | `audio.replaceClips` |
| `audio.keepRange { start, end }` | Removes everything outside a range, on every track, and moves what's kept to the start | `audio.replaceClips` |
| `audio.insertTime { at, frames, tracks, newKeys? }` | Opens silence on the named tracks, splitting a clip that lies across `at` | `audio.replaceClips` |
| `audio.addTrack { key, index, name? }` | Adds an empty track | `audio.removeTracks` |
| `audio.removeTracks { keys }` | Removes tracks with their clips. The last track can't be removed | `audio.restoreTracks` |
| `audio.moveTrack { key, to }` | Moves a track to an index | `audio.moveTrack` |
| `audio.setTrack { key, name?, gainDb?, muted?, soloed? }` | Sets the fields given, at least one | `audio.setTrack` |
| `audio.setMasterGain { gainDb }` | Sets the plan's gain | `audio.setMasterGain` |
| `audio.setChannels { channels }` | Sets the plan's channel count | `audio.setChannels` |
| `audio.setMetadata { field, value }` | As in ADR 0003 | `audio.setMetadata` |

The inverses that only undo runs stay internal, outside the portable format, as in version 1:

- **`audio.restoreClips { entries: [{ track, clip }] }`** puts clips back. It needs no index: a clip's `at` says where it goes.
- **`audio.updateClips { clips }`** sets clips, matched by key, to states with every field given.
- **`audio.placeClips { entries: [{ key, track, at }] }`** puts clips back on their tracks and positions. It's its own inverse.
- **`audio.replaceClips { edits: [{ track, index, count, clips, shift }] }`** replaces a run of neighbouring clips on each named track, then moves every clip after the run by `shift` frames. It's its own inverse, with the run it replaced and the opposite shift. So a ripple that moves a thousand clips is undone by one number, not a thousand positions.
- **`audio.restoreTracks { entries: [{ index, track }] }`** puts tracks back, with their clips and settings.

- **`newKeys` is an object, by track key:** the key of the part a cut leaves after it on that track. A track that doesn't need its key ignores it, so a caller can send one for every track it names. `audio.keepRange` needs none: it never leaves two parts of one clip.
- **What a command's schema states is checked first,** such as a gain's range, then what depends on the plan. So a command the schema refuses is refused for the schema's reason, which the vectors rely on.
- **A valid command that changes nothing is applied,** and its inverse changes nothing too. Whether it makes an undo step is the session's rule (point 4 of #54).

Every inverse is exact, as ADR 0003 requires: it carries the previous state of what changed. ADR 0003's rules for commands still hold: strict shapes, stable reasons, a pure reducer, keys carried in the command, cut clips keeping the fades of the edges they keep, and sources registered rather than carried. `audio.moveClips` by index and `audio.reorderClips` are gone: with positions, order follows time.

### Mixing

One definition, in the core, that playback and export both follow:

> `out[frame] = clamp(master × Σ over audible tracks (track gain × clip's gainAt × the clip's source frame, mixed to the plan's channels))`

- **Tracks sum at unity.** There's no automatic scaling by the number of tracks: adding an empty track must not change how the others sound.
- **Channels:** each source mixes to the plan's layout with `channelMix`, the Web Audio speaker rules, as in ADR 0003.
- **Clipping policy: clamp, measure and say so.** A mix of full-scale tracks goes over full scale. Export clamps every sample to full scale before quantising, as it does today, for every sample format, so the file matches what the output device plays. It doesn't limit or normalise on its own: a limiter changes the sound without being asked, and needs look-ahead processing that isn't built.
  - **The render reports what it clamped.** `AudioProcessor.render` and `session.export` resolve `{ blob, peakDb, clippedFrames }` instead of a `Blob`: the mix's peak before clamping, and how many frames were clamped. That's a breaking change to both.
  - **The export dialog shows it** when anything clipped: how far over the peak was, and one button that lowers the master gain by that much and exports again.
- **Playback** is the same graph in Web Audio: each clip's source and gain node, into its track's gain node, into the master's. A change of track gain, mute, solo or master gain sets a gain node with a 5 ms ramp and doesn't reschedule the clips. Export applies such a change from the frame it's set at, with no ramp; exports render a fixed plan, so the difference is never heard.
  - **As built,** every track with clips is scheduled, muted or not, into its own gain node, at its gain or at silence. That's what lets an unmute or a solo be one node's level: a muted track costs its playback, which export never pays. `output.load` compares the new plan's clips with the scheduled ones by identity, track by track, which holds because the reducer keeps a track's clips when only its settings change. When they're the same, it ramps the track nodes and the master to their new levels and reschedules nothing; the tracks' order and tracks with no clips aren't heard, so they don't reschedule either. Anything else reschedules from the playhead, as before. A ramp starts from the level a node was last sent to, so two changes within 5 ms of each other can step by the part of the first ramp that hadn't finished.
- **Rendering stays in the worker, block by block** ([ADR 0002](0002-workers-and-assets.md)). For each output block, the page copies the piece of each audible track's clip that falls in it; the worker mixes, clamps, measures and encodes. Tracks and clips are summed in plan order, in double precision, so every engine adds in the same order. A block's cost grows with the audible tracks, not with the plan's length, and muted tracks cost nothing.
- **Exports that would be silent are refused:** `empty-plan` with no clips, as before, and `nothing-audible` when every track with clips is silent.
- **An export is as long as its last audible clip** (`mixLength`), not as long as the plan: a muted scratch track never pads the file with silence. Playback's timeline is the whole plan, muted tracks included, so the playhead can reach everything an editor shows.
- **As built,** the definition is two pure functions in the core: `gatherSegments`, which copies each audible clip's part of a block, on the page, and `mixBlock`, which sums, applies the master gain, measures and clamps, in the worker. The `hm-audio-mix` vectors run both over small sources, so a port checks its mix against them. The peak is reported in decibels relative to full scale, `-Infinity` for silence.

### Limits

Two additions to [ADR 0004](0004-audio-limits.md)'s table, and two clarifications:

| Limit | Code | Default maximum | Default warning | Checked |
|---|---|---|---|---|
| `maxTracks` | `TOO_MANY_TRACKS` | 16 | none | The plan, on each command that adds tracks |
| `maxDuration`, for the plan | `DURATION_TOO_LONG` | 3 hours | none | The plan's length, on each command that can lengthen it |

- **The plan's length needs its own check.** Positions are free, so one command could place a clip a day in, and export would write a day of silence. No source limit catches that.
- **`maxClips` counts the whole plan,** across tracks. It stays at 2,000, the number `ui` measured its clip track with.
- **Total decoded size is `maxSessionSize`, unchanged at 1.5 GB,** counting every source at the session's rate after resampling. It isn't raised for multitrack: what a tab can hold didn't change. It fits about an hour of stereo at 48 kHz across all tracks together, so an hour of mono voice with music fits and two hour-long stereo tracks don't. Hosts with larger needs raise it with `maxDecodedSize`, as ADR 0004 says.
- **Readers check shapes, sessions check limits.** A document with 40 tracks is a valid document that this session's policy refuses.

### The session

- **The selection** is a range of time on some tracks: `{ start, end, tracks }`. It stays view state, outside the history. The **current track**, where an insert or a paste goes, is view state too.
- **`session.insert(file, { track?, at? })`** adds the source as a clip. Without `track`, it adds a new track for it, starting at `at`, which defaults to 0: laying a file under the others is the common case.
- **`connectOutput`** is unchanged in shape. The output's `load` takes the plan and its sources, and tells track-level changes from clip changes itself.

### The app's fifteen points

From [#54](https://github.com/ie-huss-martinez/audio-sdk/issues/54), by its numbers:

| # | Point | Ruling |
|---|---|---|
| 1 | No file name on a source | **Accepted.** `open` and `insert` take an optional `name`, kept on `AudioSourceInfo`, at most 255 code points, with control and bidirectional-override characters removed. It never goes into events, the plan or a document |
| 2 | `newKey` is required only sometimes | **Accepted.** The session creates the keys a command needs when they're absent, before executing, so the recorded command carries them and the reducer stays pure |
| 3 | No trim-to-range command | **Accepted,** as `audio.keepRange` |
| 4 | A gain already set is refused with `empty-change` | **Accepted.** A valid command that changes nothing succeeds, with no history step. `audio.setMasterGain` covers the whole recording |
| 5 | The selection after commands and undo is undefined | **Accepted.** Time edits clear it. Everything else, undo and redo included, keeps it, clamped to the plan's length and its tracks, and cleared when that leaves it empty |
| 6 | Teardown order is undocumented | **Accepted.** The session never destroys what it's given. Created without an engine, it makes its own, and `session.destroy()` releases what it made |
| 7 | Store methods aren't documented as bound | **Accepted.** The session's and the output's methods work detached, which a test checks |
| 8 | Following the playhead takes a hook | **Accepted.** `watchPlayhead(output, listener)`, framework-free. `position()` is a whole frame. The output notifies its subscribers when the playhead jumps |
| 9 | Blocked autoplay reads as an unsupported browser | **Accepted.** `details.reason: "autoplay-blocked"`, with its own text |
| 10 | The README has no playback section | **Accepted** |
| 11 | No timecode formatter | **Accepted.** `formatTimecode(frames, sampleRate)` from the root entry, giving `0:12.40` |
| 12 | No warning text helper | **Accepted.** `messages.warning(warning)`, proposed in `sdk-core` if its message object must grow |
| 13 | Picking a peak level is left to the UI | **Accepted.** `peakColumns(peaks, { from, to, columns })` returns each column's minimum and maximum, from the right level |
| 14 | `assetsUrl` is passed twice, and the inline worker's chunk is still emitted | **Accepted in part.** A session that makes its own engine and processor takes `assetsUrl` once. The chunk is a lazy import that a self-hosting page never fetches; not emitting it needs a second build of the entry, which is a family decision ([sdk-core ADR 0038](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0038-self-hosted-assets-and-worker-version.md)) and isn't made here |
| 15 | `styles.css` is only a layer declaration | **Accepted.** The editor fills it. Until then the README says it's empty |

### The editor

ADR 0005's regions stay: toolbar, timeline, transport, inspector. The root also takes `ui`'s `hm-text` class. What changes is the timeline.

- **One `Timeline`, one playhead, one lane per track.** Each track is a `group` named for it, such as "Track 2, Music, muted", holding:
  - **its header,** at the start of the lane and fixed while the timeline scrolls: the name, Mute and Solo as `ui` ToggleButtons, and the gain as a Slider. The header is a toolbar, so it's one Tab stop;
  - **its clips,** one `TimelineClips` listbox with `selectionMode="single"`, over **its waveform,** a canvas in a `TimelineLayer`, drawn with `peakColumns` for the visible range only.
- **Range selection stays here,** as [ui ADR 0011](https://github.com/ie-huss-martinez/ui/blob/main/docs/adr/0011-timeline.md) ruled: one layer over all the lanes, using `useTimelineScale` for the pointer mapping and snapping, with `seekOnPress` off on the playhead. Dragging selects the range on the lanes the drag crosses. A click moves the playhead and clears the selection.
- **What this needs from `ui`,** proposed there as an amendment to its ADR 0011, not built here:
  1. **several lanes** in one timeline, each with its own layers and clips, and a header column that doesn't scroll with time;
  2. **clips with a start,** so a lane can have silence between clips;
  3. **moving a clip by dragging its body,** along time and to another lane, reported once when the drag ends.

  `ui` designs them together with video-sdk's needs, whose detached audio tracks are lanes too.

  The editor's timeline work waits for that release. Building a second timeline here, as ADR 0005 allowed when `ui` had none, is no longer an option: `ui`'s exists, and two would drift.

**Keys,** besides ADR 0005's, which stay:

| Keys | Where | Does |
|---|---|---|
| ← →, Home, End | A track's clips | Between that track's clips, as `ui`'s listbox does |
| ↑ ↓ | A track's clips | To the clip nearest in time on the track above or below |
| Alt+← Alt+→ | A clip | Moves it 10 ms earlier or later, through `ui`'s `onMove` |
| Alt+↑ Alt+↓ | A clip | Moves it to the track above or below, at the same time |
| `M` | A track's header or clips | Mutes or unmutes the track |
| `I`, `O`, Shift with the arrows | The playhead | Selects a range, on every track |
| Delete | With a range | Deletes it from its tracks, closing the gap when Ripple is on |

- **Ripple is a toolbar toggle,** on by default, like snapping. With it on, deleting a range closes the gap on the range's tracks; with it off, silence stays. One recording on one track behaves as it does today.
- **Ripple shows what it will move.** It closes the gap only on the range's tracks, so a range on some tracks pulls them out of step with the others. While Ripple is on and a range covers only some tracks, those tracks' lanes are highlighted, and their headers say so in text, not by colour alone. The announcement after the deletion names them: "Deleted 0:04.00 to 0:09.20 from Voice. Later clips on Voice moved earlier."
- **A move that would overlap is refused,** and announced: nothing is pushed aside.
- **Solo has no key.** `S` is split, and solo is a button in each header.
- **Every drag and key has a button** (WCAG 2.5.7, and `ui`'s condition for its clip track): zoom in, zoom out and fit; trim start and trim end; move earlier, move later, to the track above and to the track below; move track up and down; add and remove track. The inspector's **Start** field sets a clip's position exactly, as a timecode.
- **Tab order:** toolbar; the playhead; then each track's header and its clips; transport; inspector. That's two stops a track. The arrows between tracks mean nobody has to tab through sixteen of them.
- **Names:** a clip is "Clip 2 of 5 on Music, 0:04.00 to 0:09.20, −3 dB". A selection is announced as "Selected 0:04.00 to 0:09.20 on 2 tracks". Mute, solo and refused moves are announced politely.
- **Not by colour alone:** a silent track is dimmed and its header says "muted" or "silenced by solo"; in forced colours the header's text carries it.
- **Focus,** adding to ADR 0005's rules: after adding a track, on its header's name. After removing one, on the header of the track that took its place, or the one above. After a move to another track, on the moved clip.
- **The inspector** shows the focused clip's start, gain and fades, and otherwise the recording's facts, the master gain and the metadata.
- **The export dialog's summary** lists the tracks that will be heard, and says when a solo or a mute leaves others out, before anything is written.
- **Layout:** lanes have a fixed height from a token, and the timeline scrolls vertically past its maximum height. Below 720 px of container width, each header sits above its lane.

### The plan to an editor release

One pull request at a time, in this order. Each code change has a changeset.

**Release 0.6.0: the headless core is multitrack.** Breaking, for the plan's shape and `export`'s result.

1. This record.
2. The README's playback section, and its status (point 10).
3. Resampling on insert, to the session's rate. Independent of tracks, and needed before them.
4. The model, behind an internal module that nothing exports: tracks and `at`, the reducer and its commands, and version 2 of both formats with their migrations and vectors. The session, the worker and the public API still run on version 1.
5. The switch: the session's plan, selection and insert, and the mix in the worker's renderer with its vectors and report, exporting the new API. This is the breaking change.
6. Playback of tracks: the graph, and gain, mute and solo without rescheduling.
7. The limits: `maxTracks` and the plan's length.
8. The session's points from #54: 1, 2, 4, 5, 6, 7 and 14.
9. The playhead and formatting points: 8, 9, 11, 12 and 13.

**In `ui`, meanwhile:** lanes, clips with a start and dragging a clip's body, in its own pull requests and release. Release 0.6.0 doesn't wait for it; the timeline's steps below do.

**Release 0.7.0: the editor.** Nothing ships from `./react` or `./element` before every step is merged ([ADR 0005](0005-editor-shell.md), [sdk-core ADR 0039](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0039-test-applications-in-each-repository.md)).

10. The provider, the hooks and the shell: the root with `hm-text`, the empty, opening and error states, and the transport.
11. The timeline: lanes, waveforms and the playhead, with zoom and its buttons.
12. Track headers and the track tools: add, remove, reorder, rename, gain, mute and solo.
13. The clip tools: range selection, delete and ripple, split, trim, move, fades, with their buttons, keys and focus rules.
14. The inspector.
15. The export dialog, with the summary and the clipping report.
16. The element.
17. `examples/vite` and `examples/next`, with keyboard-only end-to-end tests.
18. Screenshot tests of each designed state ([sdk-core ADR 0048](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0048-visual-regression-for-sdk-editors.md)).

Then the app deletes its temporary editor and renders `AudioEditor`.

### What this doesn't cover

- **Pan, and effects on a track:** each would be a field of the track and a term in the mix, in a later format version.
- **A limiter, loudness normalisation and level meters.**
- **Overlapping clips on one track,** and crossfades as one gesture.
- **Recording** into a track.
- **Saving a project with its audio:** the container that carries a document's assets is still a later record (sdk-core ADR 0045, section 2).

## Alternatives considered

- **Positions derived from a gap before each clip,** keeping ADR 0003's rule: overlap would be impossible by construction and ripple free. But a clip's place would still be a sum, every move would change two clips, and a document wouldn't say where anything is without adding up its track. A checked invariant costs less than that.
- **Silence as a kind of clip,** so tracks stay back to back and `ui`'s clip track works as it is: silence would become an option in the listbox, to be focused, named and trimmed, and every move would be an edit of two silences.
- **Overlapping clips on a track, mixed:** the listbox's order would stop being time order, hit-testing would need layers within a lane, and a second track already does it.
- **Mute and solo as view state:** an export that ignores the mute someone has just listened with is a surprise, and an export that honours state missing from the document can't be reproduced from the document.
- **Scaling the mix by the number of tracks,** or a limiter by default: both change levels nobody asked to change. Clamping and reporting leaves the decision visible.
- **Rendering each track to a buffer, then mixing:** a full-length buffer per track is exactly the memory the block renderer avoids.
- **Keeping version 1 and adding optional fields:** version 1 readers are strict, so they'd refuse the documents anyway, and one format with two meanings of `clips` couldn't be checked by a schema.
- **A grid instead of a listbox per track:** it would give one Tab stop for all tracks, but `ui`'s clip track is a listbox, shared with video-sdk, and arrows between tracks give most of the benefit.
- **One timeline per track:** several playheads and sliders for one position.
- **Shipping a single-track editor first:** every screen, key and test would be redone for tracks within weeks, and the app already has a single-track editor.

## Consequences

- **Version 0.6.0 breaks the plan's shape, several commands and `export`'s result.** Version 1 documents and commands stay readable through the migrations, which the vectors check.
- **Positions can now be wrong in ways they couldn't be,** so the reducer and the reader check order and overlap on every plan, with property tests and vectors for both.
- **The editor depends on a `ui` release** for lanes and positioned clips, and can't start its timeline before it.
- **Resampling is ours to maintain,** about 150 lines with their tests, in exchange for the same samples in every browser. It runs in JavaScript, so an hour of stereo takes about half a minute, under `maxProcessingTime`, with progress and Cancel.
- **Playback and export can differ by a 5 ms ramp** when a gain changes during playback, and by nothing in a fixed plan.
- **`sdk-core`'s `sequenceOffsets` and `locate` no longer describe a track,** which has silence in it. Locating a clip is a binary search over `at`, kept here. If video-sdk adds audio tracks in this shape, as its ADR 0003 anticipates, it moves to `sdk-core` by the rule of two consumers.
- **Sessions hold more sources at once,** so `maxSessionSize` is reached sooner, and the warning and the history trimming of ADR 0004 matter more.
