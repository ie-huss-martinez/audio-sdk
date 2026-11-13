import { resolveAssetsBase, type WorkerLike } from "@hussmartinez/sdk-core";

/** Where the audio worker comes from, and the version it must announce. */
export interface AudioWorkerSource {
  /** Loads the worker's code, on the first call, and returns how to start it. */
  readonly loadWorker: () => Promise<() => WorkerLike>;
  /** The version the worker must announce: this package's (sdk-core ADR 0038). */
  readonly version: string;
  /** Where the worker comes from, for the version error's details. */
  readonly asset?: string;
}

/**
 * The audio worker, inlined by default or self-hosted under `assetsUrl`
 * (docs/adr/0002). The engine and the processor each start their own from
 * it.
 */
export function audioWorkerSource(assetsUrl: string | URL | undefined): AudioWorkerSource {
  const selfHosted =
    assetsUrl === undefined
      ? undefined
      : new URL("audio/audio.worker.js", resolveAssetsBase(assetsUrl)).href;
  return {
    loadWorker: selfHosted
      ? async () => () => new Worker(selfHosted, { type: "module", name: "hm-audio" })
      : async () => (await import("./inline-worker.js")).createInlineWorker,
    version: __AUDIO_SDK_VERSION__,
    ...(selfHosted ? { asset: selfHosted } : {}),
  };
}
