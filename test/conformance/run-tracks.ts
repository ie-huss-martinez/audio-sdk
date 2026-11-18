import { conforms } from "@hussmartinez/sdk-config/testing/conformance";
import {
  type AudioTrackPlanDocument,
  migrateCommand,
  readTrackPlanDocument,
  toTrackPlanDocument,
} from "../../src/core/format/track-plan-document.js";
import {
  type AudioTrackCommand,
  createTrackPlanReducer,
} from "../../src/core/operations/track-commands.js";

/**
 * How the TypeScript SDK runs the multitrack conformance subjects
 * (docs/adr/0006, sdk-core ADR 0045): what a port implements too. One
 * runner per subject, shared by the generator and the tests.
 */

/**
 * `hm-audio-plan-2`: a document of version 1 or 2, read and written back as
 * version 2. A version 1 document comes back migrated.
 */
export function readAndWriteTracks(document: unknown): AudioTrackPlanDocument {
  const { plan, sources } = readTrackPlanDocument(document);
  return toTrackPlanDocument(plan, sources);
}

/**
 * `hm-audio-commands-2`: a version 2 command applied to a plan document.
 * Its inverse must restore the plan exactly, and the inverse's inverse must
 * do the command again, though inverses themselves are internal.
 */
export function applyToTracks(input: { plan: unknown; command: unknown }): AudioTrackPlanDocument {
  const { plan, sources } = readTrackPlanDocument(input.plan);
  const reduce = createTrackPlanReducer((id) =>
    Object.hasOwn(sources, id) ? sources[id]?.frames : undefined,
  );
  const { state, inverse } = reduce(plan, input.command as AudioTrackCommand);
  const undone = reduce(state, inverse).state;
  if (!conforms(toTrackPlanDocument(undone, sources), toTrackPlanDocument(plan, sources))) {
    throw new Error("The command's inverse didn't restore the plan.");
  }
  return toTrackPlanDocument(state, sources);
}

/**
 * `hm-audio-command-migration`: a version 1 command, migrated on the plan a
 * version 1 document migrates to, and applied. The migrated commands aren't
 * compared, only what they do: a refusal is the first one met, in the
 * order the format record gives the commands.
 */
export function migrateAndApply(input: {
  plan: unknown;
  command: unknown;
}): AudioTrackPlanDocument {
  const { plan, sources } = readTrackPlanDocument(input.plan);
  const reduce = createTrackPlanReducer((id) =>
    Object.hasOwn(sources, id) ? sources[id]?.frames : undefined,
  );
  let state = plan;
  for (const command of migrateCommand(input.command, plan)) {
    state = reduce(state, command).state;
  }
  return toTrackPlanDocument(state, sources);
}
