import { conforms } from "@hussmartinez/sdk-config/testing/conformance";
import { createPlanReducer } from "../../src/core/operations/commands.js";
import {
  type AudioCommand,
  type AudioPlanDocument,
  readAudioPlanDocument,
  toAudioPlanDocument,
} from "../../src/index.js";

/**
 * How the TypeScript SDK runs each conformance subject: what a port in
 * another language implements too (sdk-core ADR 0045). There's one runner
 * per subject, shared by the generator that writes the cases and the tests
 * that check them.
 */

/** `hm-audio-plan`: a document read and written back, as a reader normalises it. */
export function readAndWrite(document: unknown): AudioPlanDocument {
  const { plan, sources } = readAudioPlanDocument(document);
  return toAudioPlanDocument(plan, sources);
}

/**
 * `hm-audio-commands`: a command applied to a plan document, giving the new
 * document. Its inverse must restore the plan exactly, though the inverse's
 * own shape is internal and isn't compared.
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
