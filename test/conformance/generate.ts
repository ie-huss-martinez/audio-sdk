import type {
  ConformanceCase,
  ConformanceFile,
} from "@hussmartinez/sdk-config/testing/conformance";
import fc from "fast-check";
import { type AudioClip, NO_FADE, toAudioPlanDocument } from "../../src/index.js";
import { commandFor, planArb, SOURCES } from "../arbitraries/audio-plan.js";
import { applyToDocument, readAndWrite } from "./run.js";

/**
 * Writes the conformance cases (sdk-core ADR 0045): hand-written cases for
 * every outcome a port must reproduce, and cases generated from the
 * reducer's property-test generators with a fixed seed. The files in
 * conformance/ are this module's output, checked in; `pnpm conformance:update`
 * rewrites them, and the tests fail when they're out of date.
 */

/** The seed of the generated cases. Changing it, or fast-check's version, rewrites them. */
const SEED = 45;
/** How many generated commands that apply, and of each refusal, the file keeps. */
const GENERATED_APPLIED = 60;
const GENERATED_PER_REFUSAL = 2;
/** How many generated documents the plan file keeps. */
const GENERATED_PLANS = 20;

const sources = Object.fromEntries(Object.entries(SOURCES).map(([id, frames]) => [id, { frames }]));

/** The value as JSON carries it: what a port reads from the file. */
const asJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const clip = (
  key: string,
  source: string,
  start: number,
  end: number,
  extra: Partial<AudioClip> = {},
): AudioClip => ({
  key,
  source,
  start,
  end,
  gainDb: 0,
  fadeIn: NO_FADE,
  fadeOut: NO_FADE,
  ...extra,
});

/** Two clips: `a` plays s1 0–100, and `b` plays s2 200–300 with fades. */
const BASE = toAudioPlanDocument(
  {
    sampleRate: 48_000,
    channels: 2,
    clips: [
      clip("a", "s1", 0, 100),
      clip("b", "s2", 200, 300, {
        gainDb: -3.5,
        fadeIn: { frames: 20, curve: "equalPower" },
        fadeOut: { frames: 30, curve: "linear" },
      }),
    ],
    metadata: { title: "Take 1", artist: "", album: "", year: "", comment: "" },
  },
  sources,
);

/**
 * A plan whose source ids and clip keys are the names of `Object.prototype`'s
 * properties, built from JSON text, so `__proto__` is an own field as any
 * JSON parser makes it. Readers that keep ids in plain objects, in any
 * language, must still treat them as data.
 */
const PROTOTYPE_NAMED = JSON.parse(
  JSON.stringify({
    ...BASE,
    sources: { PROTO: { frames: 100 }, constructor: { frames: 100 }, toString: { frames: 100 } },
    clips: ["PROTO", "constructor", "toString"].map((name) => ({
      ...clip(name, name, 0, 50),
    })),
  }).replaceAll('"PROTO"', '"__proto__"'),
) as typeof BASE;

type Outcome = { readonly ok: true } | { readonly code: string; readonly reason: string };

/**
 * A case whose expected result is what the runner gives. For a hand-written
 * case, `outcome` is what the case is meant to show, and a runner that
 * disagrees fails here, before any file is written.
 */
function make(
  name: string,
  input: unknown,
  run: (input: never) => unknown,
  outcome?: Outcome,
): ConformanceCase {
  const json = asJson(input);
  let expected: unknown;
  try {
    expected = asJson(run(json as never));
  } catch (error) {
    const { code, details } = error as { code?: string; details?: { reason?: string } };
    if (typeof code !== "string" || typeof details?.reason !== "string") throw error;
    expected = { error: { code, reason: details.reason } };
  }
  if (outcome) {
    const got = (expected as { error?: Outcome }).error ?? { ok: true };
    if (JSON.stringify(got) !== JSON.stringify(outcome)) {
      throw new Error(
        `Case "${name}" gave ${JSON.stringify(got)}, not ${JSON.stringify(outcome)}.`,
      );
    }
  }
  return { name, input: json, expected };
}

const applied: Outcome = { ok: true };
const refused = (reason: string, code = "INVALID_COMMAND"): Outcome => ({ code, reason });

/** `hm-audio-commands`: a user-level command applied to a plan document. */
export function commandCases(): ConformanceFile {
  const on = (command: unknown) => ({ plan: BASE, command });
  const handWritten: [string, unknown, Outcome][] = [
    [
      "inserts a clip at the plan's end",
      on({ type: "audio.insertClips", at: 200, clips: [clip("c", "s1", 0, 10)] }),
      applied,
    ],
    [
      "inserts inside a clip, splitting it, each part keeping the fade of its own edge",
      on({ type: "audio.insertClips", at: 150, clips: [clip("c", "s1", 0, 10)], splitKey: "b2" }),
      applied,
    ],
    ["removes clips", on({ type: "audio.removeClips", keys: ["a"] }), applied],
    [
      "removes every clip, leaving an empty plan",
      on({ type: "audio.removeClips", keys: ["b", "a"] }),
      applied,
    ],
    [
      "deletes a range across clips, trimming both",
      on({ type: "audio.deleteRange", start: 50, end: 150 }),
      applied,
    ],
    [
      "deletes a range inside a clip, splitting it with newKey",
      on({ type: "audio.deleteRange", start: 10, end: 20, newKey: "a2" }),
      applied,
    ],
    [
      "trims a clip, shortening its fades in proportion",
      on({ type: "audio.trimClip", key: "b", start: 220, end: 245 }),
      applied,
    ],
    ["splits a clip", on({ type: "audio.splitClip", key: "b", at: 130, newKey: "b2" }), applied],
    ["moves clips as a block", on({ type: "audio.moveClips", keys: ["b"], to: 0 }), applied],
    [
      "sets a fractional gain, which compares exactly",
      on({ type: "audio.setGain", keys: ["a", "b"], gainDb: -0.1 }),
      applied,
    ],
    [
      "sets a fade",
      on({ type: "audio.setFade", key: "a", edge: "out", frames: 100, curve: "equalPower" }),
      applied,
    ],
    [
      "sets metadata",
      on({ type: "audio.setMetadata", field: "artist", value: "Ana Pérez 🎙" }),
      applied,
    ],
    [
      "removes a clip keyed __proto__",
      { plan: PROTOTYPE_NAMED, command: { type: "audio.removeClips", keys: ["__proto__"] } },
      applied,
    ],
    [
      "splits a clip keyed constructor, naming the new part valueOf",
      {
        plan: PROTOTYPE_NAMED,
        command: { type: "audio.splitClip", key: "constructor", at: 75, newKey: "valueOf" },
      },
      applied,
    ],
    [
      "refuses a new key named toString when a clip has it",
      {
        plan: PROTOTYPE_NAMED,
        command: { type: "audio.splitClip", key: "constructor", at: 75, newKey: "toString" },
      },
      refused("key-taken"),
    ],
    [
      "refuses a key that only Object.prototype has as an unknown clip",
      {
        plan: PROTOTYPE_NAMED,
        command: { type: "audio.setGain", keys: ["hasOwnProperty"], gainDb: 0 },
      },
      refused("unknown-clip"),
    ],
    ["refuses a command that isn't an object", on(null), refused("malformed-command")],
    [
      "refuses an unknown field",
      on({ type: "audio.removeClips", keys: ["a"], all: true }),
      refused("malformed-command"),
    ],
    [
      "refuses an unknown command",
      on({ type: "audio.normalize", keys: ["a"] }),
      refused("unknown-command"),
    ],
    [
      "refuses a clip of a source the document doesn't list",
      on({ type: "audio.insertClips", at: 0, clips: [clip("c", "s9", 0, 10)] }),
      refused("unknown-source"),
    ],
    [
      "refuses an unknown fade curve",
      on({ type: "audio.setFade", key: "a", edge: "in", frames: 5, curve: "cubic" }),
      refused("invalid-fade-curve"),
    ],
    [
      "refuses an empty list of clips",
      on({ type: "audio.removeClips", keys: [] }),
      refused("no-clips"),
    ],
    [
      "refuses a clip named twice",
      on({ type: "audio.removeClips", keys: ["a", "a"] }),
      refused("duplicate-key"),
    ],
    [
      "refuses a new key the plan has",
      on({ type: "audio.splitClip", key: "a", at: 50, newKey: "b" }),
      refused("key-taken"),
    ],
    [
      "refuses an unknown clip",
      on({ type: "audio.setGain", keys: ["z"], gainDb: 0 }),
      refused("unknown-clip"),
    ],
    [
      "refuses a frame past the plan's end",
      on({ type: "audio.insertClips", at: 201, clips: [clip("c", "s1", 0, 10)] }),
      refused("frame-outside-plan"),
    ],
    [
      "refuses an empty range",
      on({ type: "audio.deleteRange", start: 40, end: 40 }),
      refused("empty-range"),
    ],
    [
      "refuses a split on a clip's edge",
      on({ type: "audio.splitClip", key: "b", at: 100, newKey: "b2" }),
      refused("not-inside-clip"),
    ],
    [
      "refuses a split without the new part's key",
      on({ type: "audio.insertClips", at: 50, clips: [clip("c", "s1", 0, 10)] }),
      refused("new-key-required"),
    ],
    [
      "refuses a move past the end",
      on({ type: "audio.moveClips", keys: ["a"], to: 2 }),
      refused("invalid-index"),
    ],
    [
      "refuses an unknown fade edge",
      on({ type: "audio.setFade", key: "a", edge: "both", frames: 5, curve: "linear" }),
      refused("invalid-edge"),
    ],
    [
      "refuses an unknown metadata field",
      on({ type: "audio.setMetadata", field: "genre", value: "" }),
      refused("unknown-metadata-field"),
    ],
    [
      "sets metadata of 1,000 emoji: 1,000 code points, though 2,000 UTF-16 units",
      on({ type: "audio.setMetadata", field: "comment", value: "🎙".repeat(1_000) }),
      applied,
    ],
    [
      "refuses metadata of 1,001 emoji",
      on({ type: "audio.setMetadata", field: "comment", value: "🎙".repeat(1_001) }),
      refused("metadata-too-long"),
    ],
    [
      "refuses metadata over 1,000 code points",
      on({ type: "audio.setMetadata", field: "comment", value: "x".repeat(1_001) }),
      refused("metadata-too-long"),
    ],
    [
      "refuses a trim to no frames",
      on({ type: "audio.trimClip", key: "a", start: 10, end: 10 }),
      refused("clip-too-short"),
    ],
    [
      "refuses a trim past the source",
      on({ type: "audio.trimClip", key: "b", start: 0, end: 501 }),
      refused("clip-outside-source"),
    ],
    [
      "refuses a fractional frame",
      on({ type: "audio.trimClip", key: "a", start: 1.5, end: 10 }),
      refused("invalid-frames"),
    ],
    [
      "refuses a gain over 120 dB",
      on({ type: "audio.setGain", keys: ["a"], gainDb: 120.5 }),
      refused("gain-out-of-range"),
    ],
    [
      "refuses fades that don't fit the clip together",
      on({ type: "audio.setFade", key: "b", edge: "in", frames: 71, curve: "linear" }),
      refused("fades-too-long"),
    ],
  ];
  // A balanced sample: commands that apply, and a few of each refusal, so
  // the file stays small enough to review.
  const generated: ConformanceCase[] = [];
  const refusals = new Map<string, number>();
  let applies = 0;
  const samples = fc.sample(
    planArb.chain((state) => fc.tuple(fc.constant(state), commandFor(state))),
    { seed: SEED, numRuns: 2_000 },
  );
  for (const [state, command] of samples) {
    const made = make("", { plan: toAudioPlanDocument(state, sources), command }, applyToDocument);
    const reason = (made.expected as { error?: { reason: string } }).error?.reason;
    if (
      reason === undefined
        ? applies >= GENERATED_APPLIED
        : (refusals.get(reason) ?? 0) >= GENERATED_PER_REFUSAL
    ) {
      continue;
    }
    if (reason === undefined) applies += 1;
    else refusals.set(reason, (refusals.get(reason) ?? 0) + 1);
    const outcome = reason === undefined ? "applied" : `refused, ${reason}`;
    generated.push({
      ...made,
      name: `generated ${generated.length + 1}: ${command.type}, ${outcome}`,
    });
  }
  return {
    format: "hm-conformance",
    version: 1,
    subject: "hm-audio-commands",
    description:
      "audio-sdk's edit commands (docs/formats/hm-audio-plan.md). input.plan is an hm-audio-plan document and input.command an hm-audio-command; expected is the resulting document, or the rejection. Applying the command's inverse must restore the plan, but the inverse itself is internal. Generated cases come from the reducer's property-test generators, with a fixed seed.",
    cases: [
      ...handWritten.map(([name, input, outcome]) => make(name, input, applyToDocument, outcome)),
      ...generated,
    ],
  };
}

/** `hm-audio-plan`: a document read, checked and written back. */
export function planCases(): ConformanceFile {
  const document = (changes: Record<string, unknown>) => ({ ...BASE, ...changes });
  const withClip = (changes: Record<string, unknown>) =>
    document({ clips: [{ ...BASE.clips[0], ...changes }] });
  const invalidDocument = (reason: string) => refused(reason, "INVALID_DOCUMENT");
  const handWritten: [string, unknown, Outcome][] = [
    ["reads a document unchanged", BASE, applied],
    ["reads an empty plan", document({ clips: [], sources: {} }), applied],
    [
      "reads source ids and clip keys named __proto__, constructor and toString",
      PROTOTYPE_NAMED,
      applied,
    ],
    [
      "refuses a clip of a source only Object.prototype has",
      { ...PROTOTYPE_NAMED, clips: [clip("a", "hasOwnProperty", 0, 10)] },
      invalidDocument("unknown-source"),
    ],
    [
      "refuses two clips keyed __proto__",
      {
        ...PROTOTYPE_NAMED,
        clips: [PROTOTYPE_NAMED.clips[0], { ...PROTOTYPE_NAMED.clips[1], key: "__proto__" }],
      },
      invalidDocument("duplicate-key"),
    ],
    [
      "reads a source with its asset",
      document({
        sources: {
          ...BASE.sources,
          s1: {
            frames: 1_000,
            asset: { asset: `sha256:${"0a".repeat(32)}`, mediaType: "audio/wav", size: 4_044 },
          },
        },
      }),
      applied,
    ],
    [
      "refuses another format",
      document({ format: "hm-video-plan" }),
      refused("unknown-format", "UNSUPPORTED_FORMAT"),
    ],
    [
      "refuses a later version",
      document({ version: 2 }),
      refused("unknown-format-version", "UNSUPPORTED_FORMAT"),
    ],
    ["refuses a list", [BASE], invalidDocument("malformed-document")],
    [
      "refuses a version that isn't a number",
      document({ version: "1" }),
      invalidDocument("malformed-document"),
    ],
    ["refuses an unknown field", document({ tempo: 120 }), invalidDocument("malformed-document")],
    [
      "refuses a missing field",
      { ...BASE, metadata: undefined },
      invalidDocument("malformed-document"),
    ],
    [
      "refuses a sample rate of 0",
      document({ sampleRate: 0 }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses a source of 0 frames",
      document({ sources: { ...BASE.sources, s1: { frames: 0 } } }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses an asset that isn't a SHA-256",
      document({
        sources: {
          ...BASE.sources,
          s1: { frames: 1_000, asset: { asset: "md5:00", mediaType: "audio/wav", size: 1 } },
        },
      }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses a media type in capitals",
      document({
        sources: {
          ...BASE.sources,
          s1: {
            frames: 1_000,
            asset: { asset: `sha256:${"0a".repeat(32)}`, mediaType: "Audio/WAV", size: 1 },
          },
        },
      }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses an unknown clip field",
      withClip({ muted: true }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses an unknown metadata field",
      document({ metadata: { ...BASE.metadata, genre: "" } }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses a clip of a source it doesn't list",
      withClip({ source: "s9" }),
      invalidDocument("unknown-source"),
    ],
    [
      "refuses two clips with one key",
      document({ clips: [BASE.clips[0], { ...BASE.clips[1], key: "a" }] }),
      invalidDocument("duplicate-key"),
    ],
    [
      "refuses an unknown fade curve",
      withClip({ fadeIn: { frames: 0, curve: "cubic" } }),
      invalidDocument("invalid-fade-curve"),
    ],
    [
      "reads metadata of 1,000 emoji: 1,000 code points, though 2,000 UTF-16 units",
      document({ metadata: { ...BASE.metadata, title: "🎙".repeat(1_000) } }),
      applied,
    ],
    [
      "refuses metadata of 1,001 emoji",
      document({ metadata: { ...BASE.metadata, title: "🎙".repeat(1_001) } }),
      invalidDocument("metadata-too-long"),
    ],
    [
      "refuses metadata over 1,000 code points",
      document({ metadata: { ...BASE.metadata, title: "x".repeat(1_001) } }),
      invalidDocument("metadata-too-long"),
    ],
    [
      "refuses a clip of no frames",
      withClip({ start: 50, end: 50 }),
      invalidDocument("clip-too-short"),
    ],
    [
      "refuses a clip past its source",
      withClip({ end: 1_001 }),
      invalidDocument("clip-outside-source"),
    ],
    ["refuses a negative frame", withClip({ start: -1 }), invalidDocument("invalid-frames")],
    [
      "refuses a gain under -120 dB",
      withClip({ gainDb: -121 }),
      invalidDocument("gain-out-of-range"),
    ],
    [
      "refuses fades that don't fit their clip",
      withClip({
        fadeIn: { frames: 60, curve: "linear" },
        fadeOut: { frames: 41, curve: "linear" },
      }),
      invalidDocument("fades-too-long"),
    ],
  ];
  const generated = fc
    .sample(planArb, { seed: SEED, numRuns: GENERATED_PLANS })
    .map((state, index) =>
      make(
        `generated ${index + 1}: ${state.clips.length} clips`,
        toAudioPlanDocument(state, sources),
        readAndWrite,
        applied,
      ),
    );
  return {
    format: "hm-conformance",
    version: 1,
    subject: "hm-audio-plan",
    description:
      "Reading hm-audio-plan documents (docs/formats/hm-audio-plan.md): input is the document, and expected is the document as a reader writes it back, or the rejection.",
    cases: [
      ...handWritten.map(([name, input, outcome]) => make(name, input, readAndWrite, outcome)),
      ...generated,
    ],
  };
}
