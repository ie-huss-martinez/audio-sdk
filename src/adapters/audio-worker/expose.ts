import { type ExposeWorkerOptions, exposeWorker } from "@hussmartinez/sdk-core";
import { probePcm, readPcmFrames } from "../pcm/probe.js";
import { blockPeaks } from "../peaks.js";
import type { AudioWorkerContract } from "./contract.js";

/**
 * Answers the audio worker's contract (docs/adr/0002). It does nothing on
 * import, and there's no heavy initialisation, so the worker announces
 * itself at once.
 */
export function exposeAudioWorker(options?: ExposeWorkerOptions): void {
  exposeWorker<AudioWorkerContract>(
    {
      probe: ({ file }) => probePcm(file),
      async readBlock({ file, layout, start, frames, bucket }) {
        const channels = await readPcmFrames(file, layout, start, frames);
        return { channels, ...blockPeaks(channels, bucket) };
      },
      peaks: ({ channels, bucket }) => blockPeaks(channels, bucket),
    },
    options,
  );
}
