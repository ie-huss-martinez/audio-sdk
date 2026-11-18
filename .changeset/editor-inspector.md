---
"@hussmartinez/audio-sdk": minor
---

The editor has an inspector, `AudioInspector`, after the transport:

- **With a clip selected:** its Start, as a timecode such as `0:04.20` (plain seconds work too), its gain, and each fade's length in seconds with its curve, Linear or Equal power. A start that would overlap another clip is refused and announced.
- **Otherwise:** the recording's length, sample rate and tracks, its master gain, its channels, and its metadata: title, artist, album, year and comment.

Fields apply when you press Enter or leave them, and sliders when you let go, each as one undo step. Where the editor is at least 1080 px wide, the inspector sits beside the timeline; otherwise it's below the transport. `classNames` gains an `inspector` part.
