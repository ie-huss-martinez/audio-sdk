import { type ExposeWorkerOptions, exposeWorker } from "@hussmartinez/sdk-core";
import { readPcmFrames } from "../pcm/probe.js";
import { blockPeaks } from "../peaks.js";
import { probeFile } from "../probe.js";
import type { AudioWorkerContract } from "./contract.js";

/**
 * Answers the audio worker's contract (docs/adr/0002). It does nothing on
 * import, and there's no heavy initialisation, so the worker announces
 * itself at once.
 */
export function exposeAudioWorker(options?: ExposeWorkerOptions): void {
  exposeWorker<AudioWorkerContract>(
    {
      version: () => __AUDIO_SDK_VERSION__,
      probe: ({ file }) => probeFile(file),
      async readBlock({ file, layout, start, frames, bucket }) {
        const channels = await readPcmFrames(file, layout, start, frames);
        return { channels, ...blockPeaks(channels, bucket) };
      },
      peaks: ({ channels, bucket }) => blockPeaks(channels, bucket),
    },
    options,
  );
}
