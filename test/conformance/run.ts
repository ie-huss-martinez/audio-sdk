import { conforms } from "@hussmartinez/sdk-config/testing/conformance";
import { gatherSegments, mixBlock } from "../../src/core/model/mix.js";
import { createPlanReducer } from "../../src/core/operations/commands.js";
import {
  type AudioCommand,
  type AudioPlanDocument,
  dbToGain,
  migrateAudioCommand,
  mixLength,
  readAudioPlanDocument,
  toAudioPlanDocument,
} from "../../src/index.js";
import { fakeDecoded } from "../fakes/fake-audio.js";

/**
 * How the TypeScript SDK runs the multitrack conformance subjects
 * (docs/adr/0006, sdk-core ADR 0045): what a port implements too. One
 * runner per subject, shared by the generator and the tests.
 */

/**
 * `hm-audio-plan-2`: a document of version 1 or 2, read and written back as
 * version 2. A version 1 document comes back migrated.
 */
export function readAndWrite(document: unknown): AudioPlanDocument {
  const { plan, sources } = readAudioPlanDocument(document);
  return toAudioPlanDocument(plan, sources);
}

/**
 * `hm-audio-commands-2`: a version 2 command applied to a plan document.
 * Its inverse must restore the plan exactly, and the inverse's inverse must
 * do the command again, though inverses themselves are internal.
 */
export function applyToDocument(input: { plan: unknown; command: unknown }): AudioPlanDocument {
  const { plan, sources } = readAudioPlanDocument(input.plan);
  const reduce = createPlanReducer((id) =>
    Object.hasOwn(sources, id) ? sources[id]?.frames : undefined,
  );
  const { state, inverse } = reduce(plan, input.command as AudioCommand);
  const undone = reduce(state, inverse).state;
  if (!conforms(toAudioPlanDocument(undone, sources), toAudioPlanDocument(plan, sources))) {
    throw new Error("The command's inverse didn't restore the plan.");
  }
  return toAudioPlanDocument(state, sources);
}

/**
 * `hm-audio-command-migration`: a version 1 command, migrated on the plan a
 * version 1 document migrates to, and applied. The migrated commands aren't
 * compared, only what they do: a refusal is the first one met, in the
 * order the format record gives the commands.
 */
export function migrateAndApply(input: { plan: unknown; command: unknown }): AudioPlanDocument {
  const { plan, sources } = readAudioPlanDocument(input.plan);
  const reduce = createPlanReducer((id) =>
    Object.hasOwn(sources, id) ? sources[id]?.frames : undefined,
  );
  let state = plan;
  for (const command of migrateAudioCommand(input.command, plan)) {
    state = reduce(state, command).state;
  }
  return toAudioPlanDocument(state, sources);
}

/**
 * `hm-audio-mix`: a plan mixed over sources given as samples, one list per
 * channel. The result is the mix's channels, clamped to full scale, its
 * peak before clamping, where 1 is full scale, and how many frames were
 * clamped. Gains and fades are computed, so cases state a tolerance.
 */
export function mixPlan(input: {
  plan: unknown;
  sources: Record<string, readonly (readonly number[])[]>;
}): { channels: number[][]; peak: number; clipped: number } {
  const { plan } = readAudioPlanDocument(input.plan);
  const sources = new Map(
    Object.entries(input.sources).map(([id, channels]) => [
      id,
      fakeDecoded(plan.sampleRate, channels),
    ]),
  );
  const frames = mixLength(plan);
  const mixed = mixBlock({
    channels: plan.channels,
    frames,
    gain: dbToGain(plan.gainDb),
    segments: gatherSegments(plan, sources, 0, frames),
  });
  return {
    channels: mixed.channels.map((channel) => [...channel]),
    peak: mixed.peak,
    clipped: mixed.clipped,
  };
}
