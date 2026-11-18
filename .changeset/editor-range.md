---
"@hussmartinez/audio-sdk": minor
---

The editor selects ranges of time, and deletes them:

- **Select by dragging** across the timeline. The range covers the tracks the drag crosses, and snaps unless you hold Alt. A click without a drag moves the playhead and clears the selection.
- **Select with the keyboard:** `I` and `O` set the selection's start and end at the playhead, and Shift with the playhead's arrow, Page and Home/End keys extends it. Escape clears it. The toolbar's new Selection group has a button for each.
- **Delete** deletes the selected range before a selected clip, and puts the playhead and focus at the range's start.
- **Ripple**, a toggle in the Selection group, is on by default. With it on, deleting a range closes the gap on the range's tracks; with it off, silence stays. When the range covers only some tracks, their lanes and headers show that their later clips will move.
- The transport shows the selection as text, such as "Selected 0:04.00 to 0:09.20 on every track".
