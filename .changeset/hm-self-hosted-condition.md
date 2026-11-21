---
"@hussmartinez/audio-sdk": minor
---

A build that self-hosts the audio worker can now leave the inlined copy out. Set the family's `hm-self-hosted` resolve condition in your bundler, for example `resolve: { conditions: [...defaultClientConditions, "hm-self-hosted"] }` in Vite. The inlined worker then resolves to a small stub instead, saving a chunk of about 47 kB, 15 kB compressed, that your app never loaded.

With the condition set, everything that creates an engine or a processor needs `assetsUrl`: `createAudioAdapters`, `createAudioEngine`, `createAudioProcessor`, and the editor's and the element's `assetsUrl`. A worker started without it fails with `WORKER_START_FAILED`, whose `details` are `{ condition: "hm-self-hosted", missing: "assetsUrl" }`. Without the condition, nothing changes. The README shows the Vite and esbuild settings.
