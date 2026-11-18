---
"@hussmartinez/audio-sdk": minor
---

The editor's clip tools, in a new Clip group of the toolbar:

- **Split** at the playhead, with `S`. Focus moves to the part after the playhead.
- **Delete** the selected clip, with Delete or Backspace. Its track stays, with silence where the clip was.
- **Trim start** and **Trim end** set the clip's edge to the playhead, with `[` and `]`. On a clip, Alt+`[` and Alt+`]` shorten an edge by 10 ms, and with Shift they lengthen it. Dragging an edge trims too.
- **Move earlier** and **Move later** nudge the clip by 10 ms, as Alt+← and Alt+→ do on a clip. **Move to the track above** and **below** keep its time, as Alt+↑ and Alt+↓ do. A clip also moves by dragging its title strip, along time or to another track.

A move or trim that would overlap another clip, or reach past the start or the recording, is refused and announced. Nothing is pushed aside.
