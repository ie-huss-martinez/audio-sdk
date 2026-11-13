---
"@hussmartinez/audio-sdk": minor
---

Uses sdk-core's shared helpers in place of the SDK's own copies, and finishes two changes that waited for sdk-core.

- **`maxSampleRate` errors** now have `details.unit` of `"hertz"`, instead of `"count"`.
- **Duration text:** `errors.DURATION_TOO_LONG` and `warnings.maxDuration` now state the length, and the limit, such as "This recording is 3 hr, 5 min long, which is over the 3 hr limit." Hosts that override these messages can use `{actual, duration}` and `{maximum, duration}`.
- **The worker's version check** is sdk-core's handshake: the worker announces its version when it starts, instead of answering a call. A self-hosted worker from another version is still refused with `WORKER_START_FAILED`, naming the asset and both versions. Copy `dist/assets` again with this release, as after every upgrade.
- **`assetsUrl`** is resolved by sdk-core's `resolveAssetsBase`. A URL with a query or a fragment now throws `TypeError` when the engine is created, because the worker's URL would lose it.
- **A WebM or Matroska element** whose size is too large to hold exactly fails with `INVALID_AUDIO`.
