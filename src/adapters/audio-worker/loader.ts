import { resolveAssetsBase, type WorkerLike } from "@hussmartinez/sdk-core";
import { isAudioError } from "../../core/errors/audio-error.js";

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
      : // Through package.json's imports, which a build with the
        // hm-self-hosted condition maps to a stub (sdk-core ADR 0060).
        async () => (await import("#hm-audio-inline-worker")).createInlineWorker,
    version: __AUDIO_SDK_VERSION__,
    ...(selfHosted ? { asset: selfHosted } : {}),
  };
}

/**
 * The worker's own reason it couldn't start, when it gave one: sdk-core's
 * client reports a failure to create the worker as its own
 * `WORKER_START_FAILED`, with the worker's error as the cause. The stub of a
 * build that left the inlined worker out (sdk-core ADR 0060) is one, and its
 * details name the condition and the missing `assetsUrl`. Anything else is
 * returned as it is.
 */
export function startFailure(error: unknown): unknown {
  const cause = error instanceof Error ? error.cause : undefined;
  return isAudioError(cause, "WORKER_START_FAILED") ? cause : error;
}
