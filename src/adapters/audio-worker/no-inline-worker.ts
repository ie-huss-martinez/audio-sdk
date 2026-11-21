import { AudioError } from "../../core/errors/audio-error.js";

/**
 * What an application's build gets instead of the inlined audio worker when
 * it sets the `hm-self-hosted` resolve condition (sdk-core ADR 0060):
 * `#hm-audio-inline-worker` maps here, so the worker isn't bundled. Such a
 * build must pass `assetsUrl`; without it, starting the worker fails here,
 * loudly, rather than with a bare error from the module system.
 *
 * @returns Never: it always throws `WORKER_START_FAILED`.
 */
export function createInlineWorker(): Worker {
  throw new AudioError(
    "WORKER_START_FAILED",
    "This build left the audio SDK's inlined worker out, with the hm-self-hosted condition, so assetsUrl is required.",
    { details: { condition: "hm-self-hosted", missing: "assetsUrl" } },
  );
}
