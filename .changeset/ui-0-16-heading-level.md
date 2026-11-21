---
"@hussmartinez/audio-sdk": minor
---

The editor now needs `@hussmartinez/ui` ^0.16.0. Move your own `ui` dependency to ^0.16.0 too, so your app keeps a single copy of it.

The editor's headings follow sdk-core ADR 0058:

- **`headingLevel`'s type is `ui`'s `HeadingLevel`,** which `@hussmartinez/audio-sdk/react` re-exports. `AudioHeadingLevel` still works, as a deprecated alias that goes in the next breaking release.
- **The inspector's title is `ui`'s `Heading`,** at the level you set, or 2. Its size no longer changes with the level: an `h3` or `h4` title used to be smaller than an `h2`. It now has `ui`'s title style, as dialog titles do, a little smaller than the browser's `h2`.
- **`<hm-audio-editor>` takes a `heading-level` attribute,** beside the `headingLevel` property. A value that isn't 2 to 6 is treated as 2.

```html
<hm-audio-editor heading-level="3"></hm-audio-editor>
```
