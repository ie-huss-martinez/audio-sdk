---
"@hussmartinez/audio-sdk": minor
---

**Multitrack.** The plan is now a list of tracks, each with a name, a gain, mute and solo, and clips placed in time. Tracks play together, and `export()` mixes them. This changes the plan's shape, most commands and what `export()` returns.

**The plan**

- `plan.clips` is gone: clips are in `plan.tracks[i].clips`, and each has `at`, the timeline frame it starts on. A track's clips are in time order and never overlap. `plan.gainDb` is the master gain.
- `planLength(plan)` is where the last clip on any track ends. `clipOffsets` is removed: read `clip.at`. New: `audibleTracks`, `mixLength`, `clipEnd`, `trackLength` and `clipAt`.
- `session.open()` makes one track with one clip, so a single recording reads as `plan.tracks[0].clips[0]`.

**Commands**

- Clip edits no longer move other clips. `audio.insertClips { track, clips }` needs free space, `audio.removeClips` leaves silence, and `audio.trimClip` keeps the audio where it is on the timeline. Each fails with `clips-overlap` rather than push a neighbour.
- Closing a gap is asked for: `audio.deleteRange { start, end, tracks, ripple, newKeys? }`. To get the old `audio.deleteRange { start, end, newKey }`, name every track, set `ripple: true`, and pass `newKeys: { [trackKey]: session.createKey() }`.
- `audio.moveClips` is now `{ keys, by, track? }`: a move in time, and to another track. `audio.reorderClips` is removed.
- New: `audio.keepRange`, `audio.insertTime`, `audio.addTrack`, `audio.removeTracks`, `audio.moveTrack`, `audio.setTrack`, `audio.setMasterGain` and `audio.setChannels`.
- `migrateAudioCommand(command, plan)` turns a stored version 1 command into the version 2 commands with the same effect.

**The session**

- **`session.insert()` no longer appends.** It adds the recording on a new track of its own, starting at `at`, which defaults to 0, so it plays together with what's there. To append as before, name the track and its end: `session.insert(file, { track: track.key, at: trackLength(track) })`, with `track` being `plan.tracks[0]`. A recording with more channels than the plan widens the plan.
- `snapshot.selection` is `{ start, end, tracks }`, and `session.select()` takes optional `tracks`.
- `session.export()` resolves `{ blob, peakDb, clippedFrames }` instead of a `Blob`: use `.blob`. A mix of tracks can go over full scale; it's clamped, and `peakDb` and `clippedFrames` say how far and how often. An export with every track silent is refused with the reason `nothing-audible`.
- An export ends where the last audible clip ends. Silence after it isn't exported, and a muted track doesn't lengthen the file: for a pause at the end, put a clip there.

**Documents**

- `toAudioPlanDocument` writes `hm-audio-plan` version 2, and `readAudioPlanDocument` reads versions 1 and 2, returning a multitrack plan: a version 1 document becomes one track. The version 2 schemas ship in `formats/`.

**If you pass your own `processor`,** `render()` must mix the plan's audible tracks, with track and master gains, and resolve `{ blob, peakDb, clippedFrames }`. An `output` gets the plan with tracks in `load()`.
