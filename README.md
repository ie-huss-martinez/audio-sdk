# audio-sdk

A client-side audio SDK: trim, split, fade, adjust gain and export audio entirely in the browser. Audio never leaves the device. It offers a headless core, a React editor (`AudioEditor`) and a `<hm-audio-editor>` custom element.

This repository will publish **`@hussmartinez/audio-sdk`**. It follows the family standards in [`sdk-core`'s `STANDARDS.md`](https://github.com/ie-huss-martinez/sdk-core/blob/main/STANDARDS.md), and in particular the decisions on [hostile input and no network](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0012-hostile-input-and-no-network.md), [workers and assets](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0011-worker-messaging-and-assets.md) and [ports and adapters](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0008-ports-adapters-and-session.md).

> Status: being bootstrapped. No packages are published yet.

## License

[Apache-2.0](LICENSE)
