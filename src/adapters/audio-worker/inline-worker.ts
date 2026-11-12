import AudioWorker from "../../workers/audio.worker.ts?worker&inline";

/** Starts the inlined audio worker, from its own lazy chunk. */
export function createInlineWorker(): Worker {
  return new AudioWorker({ name: "hm-audio" });
}
