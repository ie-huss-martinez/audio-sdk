---
"@hussmartinez/audio-sdk": patch
---

`audioErrorText` and `audioWarningText` are deprecated, and go in the next breaking release. sdk-core's `Messages` now does what they did, so call it directly:

```ts
// Before
showError(audioErrorText(messages, error));
for (const warning of snapshot.warnings) show(audioWarningText(messages, warning));
// After
showError(messages.error(error));
for (const warning of snapshot.warnings) show(messages.warning(warning));
```

`messages.error` looks for an error's text by its code and `details.reason` first, such as the blocked-autoplay text, then by its code. `messages.warning` gives a limit's warning or `truncated` its text. Both helpers still work, as one-line calls to these, and every text is the same.
