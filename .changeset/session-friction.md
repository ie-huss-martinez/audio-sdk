---
"@hussmartinez/audio-sdk": minor
---

Make the session easier to build a UI on.

- **`createAudioAdapters({ assetsUrl })`** makes the engine, the processor and the output with one set of options, so a self-hosted worker's address is given once. Its `destroy()` releases all three. You still own them: the session never destroys what it's given, as before.
- **Recordings have names:** `open()` and `insert()` take an optional `name`, and use a `File`'s own name without one. It's on each entry of `snapshot.sources`, as `name`, with control and bidirectional formatting characters removed and at most 255 code points. It never goes into events, the plan or a document.
- **The session gives commands the keys they leave out:** `newKey` in `audio.splitClip`, `key` in `audio.addTrack`, and the `newKeys` of `audio.deleteRange` and `audio.insertTime`. You no longer need `session.createKey()` for those, though passing your own still works.
- **A command that changes nothing succeeds without an undo step,** such as setting a gain that's already set. Before, some were refused.
- **The selection follows defined rules:** a time edit (`audio.deleteRange`, `audio.keepRange`, `audio.insertTime`) clears it; other edits, undo and redo keep it, clamped to the plan.
- **The session's and the output's methods work on their own,** so `useSyncExternalStore(session.subscribe, session.getSnapshot)` works as written.

If you relied on a time edit shrinking the selection, select again after it.
