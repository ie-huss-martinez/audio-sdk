---
"@hussmartinez/audio-sdk": patch
---

The editor's notices show one notice per kind of warning, with that kind's different sentences, so two recordings that raise the same warning no longer show the same sentence twice, and Dismiss hides that kind. Each kind is announced once, politely, as it first appears, such as a long or truncated recording after it's added, so a screen-reader user hears it as well as sees it; undo and redo never announce it again. Messages said at the same moment, such as "Recording added." and its warning, are now said together, so neither replaces the other.
