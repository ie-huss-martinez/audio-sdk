import { type ExposeWorkerOptions, exposeWorker } from "@hussmartinez/sdk-core";
import { readPcmFrames } from "../pcm/probe.js";
import { blockPeaks } from "../peaks.js";
import { probeFile } from "../probe.js";
import { renderBlock } from "../wav/render-block.js";
import { wavHeader } from "../wav/wav-writer.js";
import type { AudioWorkerContract } from "./contract.js";

/**
 * Answers the audio worker's contract (docs/adr/0002). It does nothing on
 * import, and there's no heavy initialisation, so the worker announces
 * itself at once, with the package version it was built from, which the
 * page checks (sdk-core ADR 0038).
 */
export function exposeAudioWorker(options?: ExposeWorkerOptions): void {
  exposeWorker<AudioWorkerContract>(
    {
      probe: ({ file }) => probeFile(file),
      async readBlock({ file, layout, start, frames, bucket }) {
        const channels = await readPcmFrames(file, layout, start, frames);
        return { channels, ...blockPeaks(channels, bucket) };
      },
      peaks: ({ channels, bucket }) => blockPeaks(channels, bucket),
      wavHeader: (spec) => wavHeader(spec),
      renderBlock: (input) => renderBlock(input),
    },
    { ...options, packageVersion: __AUDIO_SDK_VERSION__ },
  );
}
