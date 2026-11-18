import type { AudioPlanDocumentSource } from "../../src/core/format/document-parts.js";
import { type AudioPlanV1, readPlanDocumentV1 } from "../../src/core/format/version-1.js";

/**
 * Version 1's documents, for the reference tests. The package still reads
 * them, and migrates what it reads; it no longer writes them, so the writer
 * lives here.
 */

/** `hm-audio-plan` version 1. */
export interface AudioPlanDocumentV1 extends AudioPlanV1 {
  readonly format: "hm-audio-plan";
  readonly version: 1;
  readonly sources: Readonly<Record<string, AudioPlanDocumentSource>>;
}

/** Reads a version 1 document as version 1, without migrating it. */
export const readAudioPlanDocument = readPlanDocumentV1;

/** Writes a version 1 plan as a version 1 document. */
export function toAudioPlanDocument(
  plan: AudioPlanV1,
  sources: Readonly<Record<string, AudioPlanDocumentSource>>,
): AudioPlanDocumentV1 {
  for (const clip of plan.clips) {
    if (!Object.hasOwn(sources, clip.source)) {
      throw new TypeError(`The sources don't include ${clip.source}, which clip ${clip.key} uses.`);
    }
  }
  return {
    format: "hm-audio-plan",
    version: 1,
    sampleRate: plan.sampleRate,
    channels: plan.channels,
    sources: Object.fromEntries(
      Object.entries(sources).map(([id, { frames, asset }]) => [
        id,
        asset === undefined ? { frames } : { frames, asset: { ...asset } },
      ]),
    ),
    clips: plan.clips.map(({ key, source, start, end, gainDb, fadeIn, fadeOut }) => ({
      key,
      source,
      start,
      end,
      gainDb,
      fadeIn: { frames: fadeIn.frames, curve: fadeIn.curve },
      fadeOut: { frames: fadeOut.frames, curve: fadeOut.curve },
    })),
    metadata: { ...plan.metadata },
  };
}
