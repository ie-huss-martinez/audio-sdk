---
"@hussmartinez/audio-sdk": minor
---

The editor edits what a range covers, and fades clips from the toolbar:

- **Fade in** and **Fade out** join the toolbar's Clip group. With a range selected, the range's clips are split at its edges, then Fade in fades each track's first piece inside the range in, over that piece, and Fade out fades its last piece out, as one undo step. A fade belongs to a clip, so where the range spans several clips, only the first or last one fades. With a clip selected and no range, the clip gets a half-second fade, which the inspector then sets exactly.
- **The inspector's Selection section**, shown while a range is selected, sets the gain of everything in the range, splitting its clips at its edges, as one undo step.
- **`headingLevel`** on `AudioEditor` and `AudioInspector`, from 2 to 6, sets the level of the inspector's heading, which is now a heading rather than a paragraph, so it fits your page's outline. It defaults to 2. The new `AudioHeadingLevel` type names the levels.
