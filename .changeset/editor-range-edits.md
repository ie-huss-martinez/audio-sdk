---
"@hussmartinez/audio-sdk": minor
---

The editor edits what a range covers, and fades clips from the toolbar:

- **Fade in** and **Fade out** join the toolbar's Clip group. With a range selected, each of its tracks fades in at the range's start, or out at its end, over the range: its clips are split at the range's edges, as one undo step. With a clip selected and no range, the clip gets a half-second fade, which the inspector then sets exactly.
- **The inspector's Selection section**, shown while a range is selected, sets the gain of everything in the range, splitting its clips at its edges, as one undo step.
- **`headingLevel`** on `AudioEditor` and `AudioInspector`, from 2 to 6, sets the level of the inspector's heading, which is now a heading rather than a paragraph, so it fits your page's outline. It defaults to 2. The new `AudioHeadingLevel` type names the levels.
