---
"@hussmartinez/audio-sdk": minor
---

The editor's tracks and tools:

- **`AudioToolbar`**, at the top of `AudioEditor`: Open and Add recording, Undo and Redo, Add, Remove and Move track up or down, and the zoom buttons. The `tools` and `toolbar` props choose the tools and their groups by id, such as `tools={["audio.undo", "audio.redo"]}`.
- **Each track's header:** its name, which opens a dialog to rename it, Mute, Solo, and its gain. A gain drag is one undo step.
- **Keys** while focus is in the editor: Ctrl+Z and Ctrl+Shift+Z (⌘ on Apple) to undo and redo, `+`, `-` and `0` to zoom, `M` to mute the current track, Space to play and pause, and Home and End to go to the start and the end.
- `classNames` gains a `toolbar` part.

`@hussmartinez/sdk-core` is now `^0.4.4`.
