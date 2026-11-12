# Architecture decision records

Decisions specific to `@hussmartinez/audio-sdk`. Decisions for the whole SDK family live in [`sdk-core`'s `docs/adr`](https://github.com/ie-huss-martinez/sdk-core/tree/main/docs/adr); the records here build on them and never contradict them. To change a family decision, write a record in `sdk-core`.

Each record captures one significant decision: the context that forced it, what we chose, the alternatives we rejected and the consequences we accept. Records are numbered and immutable. To change a decision, write a new record that supersedes the old one and link the two.

Use [`template.md`](template.md) for new records. Name files `NNNN-short-title.md`, taking the next free number.

| # | Decision | Status |
|---|---|---|
| [0001](0001-audio-engines.md) | Audio engines: our own readers and encoders, and the browser's decoders | Accepted |
| [0002](0002-workers-and-assets.md) | One audio worker, sources on the page, and assets without the network | Accepted |
| [0003](0003-clip-plan-document-model.md) | The clip plan: edits change a model, and audio is rendered on export | Accepted |
| [0004](0004-audio-limits.md) | Audio limits and session memory | Accepted |
