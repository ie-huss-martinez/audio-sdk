import type {
  ConformanceCase,
  ConformanceFile,
} from "@hussmartinez/sdk-config/testing/conformance";
import fc from "fast-check";
import { toTrackPlanDocument } from "../../src/core/format/track-plan-document.js";
import type { AudioTrack, AudioTrackClip } from "../../src/core/model/tracks.js";
import { type AudioClip, NO_FADE, toAudioPlanDocument } from "../../src/index.js";
import { commandFor, planArb } from "../arbitraries/audio-plan.js";
import { SOURCES, trackCommandFor, trackPlanArb } from "../arbitraries/track-plan.js";
import { applied, make, type Outcome, refused } from "./generate.js";
import { applyToTracks, migrateAndApply, readAndWriteTracks } from "./run-tracks.js";

/**
 * Writes the multitrack conformance cases (docs/adr/0006, sdk-core ADR
 * 0045): hand-written cases for every outcome a port must reproduce, and
 * cases generated from the reducer's property-test generators with a fixed
 * seed. `pnpm conformance:update` rewrites the files, and the tests fail
 * when they're out of date.
 */

const SEED = 6;
const GENERATED_APPLIED = 60;
const GENERATED_PER_REFUSAL = 2;
/** The most generated cases that apply, of any one command. */
const GENERATED_PER_COMMAND = 6;
const GENERATED_PLANS = 20;
const GENERATED_MIGRATIONS = 40;

const sources = Object.fromEntries(Object.entries(SOURCES).map(([id, frames]) => [id, { frames }]));

const clip = (
  key: string,
  at: number,
  source: string,
  start: number,
  end: number,
  extra: Partial<AudioTrackClip> = {},
): AudioTrackClip => ({
  key,
  at,
  source,
  start,
  end,
  gainDb: 0,
  fadeIn: NO_FADE,
  fadeOut: NO_FADE,
  ...extra,
});

const track = (
  key: string,
  clips: AudioTrackClip[],
  extra: Partial<AudioTrack> = {},
): AudioTrack => ({
  key,
  name: "",
  gainDb: 0,
  muted: false,
  soloed: false,
  clips,
  ...extra,
});

/**
 * Voice: `a` at 0–100, and `b` at 150–250 with fades. Music, at −6 dB: `m`
 * at 50–350.
 */
const BASE = toTrackPlanDocument(
  {
    sampleRate: 48_000,
    channels: 2,
    gainDb: -1.5,
    tracks: [
      track(
        "voice",
        [
          clip("a", 0, "s1", 0, 100),
          clip("b", 150, "s1", 200, 300, {
            gainDb: -3.5,
            fadeIn: { frames: 20, curve: "equalPower" },
            fadeOut: { frames: 30, curve: "linear" },
          }),
        ],
        { name: "Voice" },
      ),
      track("music", [clip("m", 50, "s2", 0, 300)], { gainDb: -6, name: "Music 🎵" }),
    ],
    metadata: { title: "Take 1", artist: "", album: "", year: "", comment: "" },
  },
  sources,
);

/**
 * A plan whose source ids, track keys and clip keys are the names of
 * `Object.prototype`'s properties, built from JSON text, so `__proto__` is
 * an own field as any JSON parser makes it.
 */
const PROTOTYPE_NAMED = JSON.parse(
  JSON.stringify({
    ...BASE,
    sources: { PROTO: { frames: 100 }, constructor: { frames: 100 } },
    tracks: [
      track("PROTO", [clip("toString", 0, "PROTO", 0, 50)]),
      track("constructor", [clip("valueOf", 10, "constructor", 0, 50)]),
    ],
  }).replaceAll('"PROTO"', '"__proto__"'),
) as typeof BASE;

const invalidDocument = (reason: string) => refused(reason, "INVALID_DOCUMENT");

/** The generated cases a file keeps: some that apply, and a few of each refusal. */
function keepSome(
  samples: readonly { input: unknown; label: string }[],
  run: (input: never) => unknown,
  applies: number,
): ConformanceCase[] {
  const kept: ConformanceCase[] = [];
  const refusals = new Map<string, number>();
  const perLabel = new Map<string, number>();
  let appliedCount = 0;
  for (const { input, label } of samples) {
    const made = make("", input, run);
    const reason = (made.expected as { error?: { reason: string } }).error?.reason;
    if (
      reason === undefined
        ? appliedCount >= applies || (perLabel.get(label) ?? 0) >= GENERATED_PER_COMMAND
        : (refusals.get(reason) ?? 0) >= GENERATED_PER_REFUSAL
    ) {
      continue;
    }
    if (reason === undefined) {
      appliedCount += 1;
      perLabel.set(label, (perLabel.get(label) ?? 0) + 1);
    } else refusals.set(reason, (refusals.get(reason) ?? 0) + 1);
    const outcome = reason === undefined ? "applied" : `refused, ${reason}`;
    kept.push({ ...made, name: `generated ${kept.length + 1}: ${label}, ${outcome}` });
  }
  return kept;
}

/** `hm-audio-commands-2`: a version 2 command applied to a plan document. */
export function trackCommandCases(): ConformanceFile {
  const on = (command: unknown) => ({ plan: BASE, command });
  const range = (extra: object) => ({
    type: "audio.deleteRange",
    start: 60,
    end: 200,
    tracks: ["voice"],
    ripple: true,
    ...extra,
  });
  const handWritten: [string, unknown, Outcome][] = [
    [
      "inserts clips in free space, in any order",
      on({
        type: "audio.insertClips",
        track: "voice",
        clips: [clip("d", 300, "s1", 0, 10), clip("c", 100, "s1", 0, 50)],
      }),
      applied,
    ],
    [
      "refuses an insert that would overlap",
      on({ type: "audio.insertClips", track: "voice", clips: [clip("c", 90, "s1", 0, 20)] }),
      refused("clips-overlap"),
    ],
    [
      "refuses a new clip with a track's key",
      on({ type: "audio.insertClips", track: "voice", clips: [clip("music", 300, "s1", 0, 20)] }),
      refused("key-taken"),
    ],
    [
      "refuses an insert on a track the plan doesn't have",
      on({ type: "audio.insertClips", track: "drums", clips: [clip("c", 300, "s1", 0, 20)] }),
      refused("unknown-track"),
    ],
    [
      "refuses a clip without a position",
      on({
        type: "audio.insertClips",
        track: "voice",
        clips: [{ ...clip("c", 300, "s1", 0, 20), at: undefined }],
      }),
      refused("invalid-frames"),
    ],
    [
      "removes clips on two tracks, leaving silence",
      on({ type: "audio.removeClips", keys: ["m", "a"] }),
      applied,
    ],
    [
      "trims a clip's start, keeping its audio where it was",
      on({ type: "audio.trimClip", key: "b", start: 220, end: 300 }),
      applied,
    ],
    [
      "trims a clip, shortening its fades in proportion",
      on({ type: "audio.trimClip", key: "b", start: 200, end: 225 }),
      applied,
    ],
    [
      "refuses a trim that would reach into the clip before",
      on({ type: "audio.trimClip", key: "b", start: 140, end: 300 }),
      refused("clips-overlap"),
    ],
    ["splits a clip", on({ type: "audio.splitClip", key: "m", at: 100, newKey: "m2" }), applied],
    [
      "refuses a split on a clip's edge",
      on({ type: "audio.splitClip", key: "b", at: 150, newKey: "b2" }),
      refused("not-inside-clip"),
    ],
    ["moves a clip earlier", on({ type: "audio.moveClips", keys: ["b"], by: -50 }), applied],
    [
      "moves clips to another track, keeping their spacing",
      on({ type: "audio.moveClips", keys: ["a", "b"], by: 400, track: "music" }),
      applied,
    ],
    [
      "moves a clip past its neighbour, where there's room",
      on({ type: "audio.moveClips", keys: ["a"], by: 250 }),
      applied,
    ],
    [
      "refuses a move that would overlap",
      on({ type: "audio.moveClips", keys: ["b"], by: -51 }),
      refused("clips-overlap"),
    ],
    [
      "refuses a move before the timeline's start",
      on({ type: "audio.moveClips", keys: ["a"], by: -1 }),
      refused("frame-outside-plan"),
    ],
    [
      "sets a fractional gain, which compares exactly",
      on({ type: "audio.setGain", keys: ["a", "m"], gainDb: -0.1 }),
      applied,
    ],
    [
      "sets a fade",
      on({ type: "audio.setFade", key: "a", edge: "out", frames: 100, curve: "equalPower" }),
      applied,
    ],
    ["deletes a range with ripple, on one track", on(range({})), applied],
    [
      "deletes a range without ripple, on two tracks, splitting a clip",
      on(range({ tracks: ["voice", "music"], ripple: false, newKeys: { music: "m2" } })),
      applied,
    ],
    [
      "deletes a range of silence with ripple, moving what's after it",
      on(range({ start: 100, end: 150 })),
      applied,
    ],
    [
      "ignores a new key a track doesn't need, even a taken one",
      on(range({ start: 100, end: 150, newKeys: { voice: "a" } })),
      applied,
    ],
    [
      "refuses a range inside a clip without a new key for its track",
      on(range({ start: 100, end: 110, tracks: ["music"] })),
      refused("new-key-required"),
    ],
    [
      "refuses a new key for a track the command doesn't edit",
      on(range({ newKeys: { music: "m2" } })),
      refused("unknown-track"),
    ],
    ["refuses an empty range", on(range({ end: 60 })), refused("empty-range")],
    ["refuses a range past the plan's end", on(range({ end: 351 })), refused("frame-outside-plan")],
    ["refuses a range that names no tracks", on(range({ tracks: [] })), refused("no-tracks")],
    [
      "refuses a range that names a track twice",
      on(range({ tracks: ["voice", "voice"] })),
      refused("duplicate-key"),
    ],
    [
      "keeps a range on every track, moved to the start",
      on({ type: "audio.keepRange", start: 80, end: 200 }),
      applied,
    ],
    [
      "opens time on two tracks, splitting the clip across the frame",
      on({
        type: "audio.insertTime",
        at: 100,
        frames: 30,
        tracks: ["voice", "music"],
        newKeys: { music: "m2" },
      }),
      applied,
    ],
    [
      "refuses to open no time",
      on({ type: "audio.insertTime", at: 100, frames: 0, tracks: ["voice"] }),
      refused("invalid-frames"),
    ],
    [
      "adds a named track",
      on({ type: "audio.addTrack", key: "fx", index: 1, name: "Effects" }),
      applied,
    ],
    [
      "adds a track named with 100 emoji: 100 code points, though 200 UTF-16 units",
      on({ type: "audio.addTrack", key: "fx", index: 2, name: "🎵".repeat(100) }),
      applied,
    ],
    [
      "refuses a track name of 101 emoji",
      on({ type: "audio.addTrack", key: "fx", index: 2, name: "🎵".repeat(101) }),
      refused("name-too-long"),
    ],
    [
      "refuses a track past the end",
      on({ type: "audio.addTrack", key: "fx", index: 3 }),
      refused("invalid-index"),
    ],
    ["removes a track", on({ type: "audio.removeTracks", keys: ["voice"] }), applied],
    [
      "refuses to remove every track",
      on({ type: "audio.removeTracks", keys: ["music", "voice"] }),
      refused("last-track"),
    ],
    ["moves a track", on({ type: "audio.moveTrack", key: "voice", to: 1 }), applied],
    [
      "mutes a track and sets its gain, leaving its other fields",
      on({ type: "audio.setTrack", key: "music", muted: true, gainDb: -12 }),
      applied,
    ],
    ["solos a track", on({ type: "audio.setTrack", key: "voice", soloed: true }), applied],
    [
      "refuses a track change that sets nothing",
      on({ type: "audio.setTrack", key: "music" }),
      refused("empty-change"),
    ],
    ["sets the master gain", on({ type: "audio.setMasterGain", gainDb: -3.25 }), applied],
    ["sets the channel count", on({ type: "audio.setChannels", channels: 1 }), applied],
    [
      "sets metadata",
      on({ type: "audio.setMetadata", field: "artist", value: "Ana Pérez 🎙" }),
      applied,
    ],
    [
      "deletes inside a clip on a track keyed __proto__, with its new key by that name",
      {
        plan: PROTOTYPE_NAMED,
        command: JSON.parse(
          '{"type":"audio.deleteRange","start":10,"end":20,"tracks":["__proto__"],"ripple":false,"newKeys":{"__proto__":"hasOwnProperty"}}',
        ),
      },
      applied,
    ],
    [
      "refuses a new key named valueOf when a clip has it",
      {
        plan: PROTOTYPE_NAMED,
        command: { type: "audio.splitClip", key: "toString", at: 25, newKey: "valueOf" },
      },
      refused("key-taken"),
    ],
    [
      "refuses a track that only Object.prototype has",
      { plan: PROTOTYPE_NAMED, command: { type: "audio.removeTracks", keys: ["hasOwnProperty"] } },
      refused("unknown-track"),
    ],
    ["refuses a command that isn't an object", on(null), refused("malformed-command")],
    [
      "refuses a version 1 command that version 2 doesn't have",
      on({ type: "audio.reorderClips", order: ["a", "b", "m"] }),
      refused("unknown-command"),
    ],
    [
      "refuses a field the command doesn't have",
      on({ type: "audio.removeClips", keys: ["a"], ripple: true }),
      refused("malformed-command"),
    ],
  ];
  const samples = fc
    .sample(
      trackPlanArb.chain((state) => fc.tuple(fc.constant(state), trackCommandFor(state))),
      { seed: SEED, numRuns: 1_500 },
    )
    .map(([state, command]) => ({
      input: { plan: toTrackPlanDocument(state, sources), command },
      label: command.type,
    }));
  return {
    format: "hm-conformance",
    version: 1,
    subject: "hm-audio-commands-2",
    description:
      "audio-sdk's edit commands on a multitrack plan (docs/formats/hm-audio-plan.md, docs/adr/0006). input.plan is an hm-audio-plan document of version 2 and input.command an hm-audio-command of version 2; expected is the resulting document, or the rejection. Applying the command's inverse must restore the plan, but the inverse itself is internal. Generated cases come from the reducer's property-test generators, with a fixed seed.",
    cases: [
      ...handWritten.map(([name, input, outcome]) => make(name, input, applyToTracks, outcome)),
      ...keepSome(samples, applyToTracks, GENERATED_APPLIED),
    ],
  };
}

/** `hm-audio-plan-2`: a document of version 1 or 2, read and written back as version 2. */
export function trackPlanCases(): ConformanceFile {
  const document = (changes: object) => ({ ...BASE, ...changes });
  const [voice, music] = BASE.tracks as [AudioTrack, AudioTrack];
  const [a, b] = voice.clips as [AudioTrackClip, AudioTrackClip];
  const withVoice = (changes: object) => document({ tracks: [{ ...voice, ...changes }, music] });
  const earlier = (clips: AudioClip[]) =>
    toAudioPlanDocument(
      { sampleRate: 44_100, channels: 1, clips, metadata: BASE.metadata },
      sources,
    );
  const v1Clip = (key: string, start: number, end: number): AudioClip => ({
    key,
    source: "s1",
    start,
    end,
    gainDb: -2,
    fadeIn: { frames: 5, curve: "linear" },
    fadeOut: NO_FADE,
  });
  const handWritten: [string, unknown, Outcome][] = [
    ["reads a plan of two tracks", BASE, applied],
    ["reads tracks and clips named like Object.prototype's properties", PROTOTYPE_NAMED, applied],
    ["reads a track with no clips", document({ tracks: [track("only", [])] }), applied],
    ["reads clips that touch", withVoice({ clips: [a, { ...b, at: 100 }] }), applied],
    [
      "migrates a version 1 document: one track, its clips back to back",
      earlier([v1Clip("a", 0, 100), v1Clip("b", 200, 250)]),
      applied,
    ],
    ["migrates a version 1 document with no clips", earlier([]), applied],
    [
      "migrates a version 1 document whose clips are keyed t1 and t2: the track takes t3",
      earlier([v1Clip("t1", 0, 10), v1Clip("t2", 0, 10)]),
      applied,
    ],
    [
      "refuses a version 1 document with tracks",
      { ...earlier([v1Clip("a", 0, 100)]), tracks: [] },
      invalidDocument("malformed-document"),
    ],
    [
      "refuses a version 2 document with version 1's clips",
      document({ clips: [] }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses a later version",
      document({ version: 3 }),
      refused("unknown-format-version", "UNSUPPORTED_FORMAT"),
    ],
    [
      "refuses another format",
      document({ format: "hm-video-plan" }),
      refused("unknown-format", "UNSUPPORTED_FORMAT"),
    ],
    ["refuses a plan with no tracks", document({ tracks: [] }), invalidDocument("no-tracks")],
    [
      "refuses clips that overlap",
      withVoice({ clips: [a, { ...b, at: 99 }] }),
      invalidDocument("clips-overlap"),
    ],
    [
      "refuses clips out of time order",
      withVoice({ clips: [b, a] }),
      invalidDocument("clips-out-of-order"),
    ],
    [
      "refuses a clip with a track's key",
      withVoice({ clips: [a, { ...b, key: "music" }] }),
      invalidDocument("duplicate-key"),
    ],
    [
      "refuses a key used on two tracks",
      document({ tracks: [voice, { ...music, clips: [{ ...music.clips[0], key: "a" }] }] }),
      invalidDocument("duplicate-key"),
    ],
    [
      "refuses a clip without a position",
      withVoice({ clips: [{ ...a, at: undefined }] }),
      invalidDocument("invalid-frames"),
    ],
    [
      "refuses a position that isn't a whole frame",
      withVoice({ clips: [{ ...a, at: 0.5 }] }),
      invalidDocument("invalid-frames"),
    ],
    ["reads a track name of 100 emoji", withVoice({ name: "🎙".repeat(100) }), applied],
    [
      "refuses a track name of 101 emoji",
      withVoice({ name: "🎙".repeat(101) }),
      invalidDocument("name-too-long"),
    ],
    [
      "refuses a track gain over 120 dB",
      withVoice({ gainDb: 121 }),
      invalidDocument("gain-out-of-range"),
    ],
    [
      "refuses a master gain under -120 dB",
      document({ gainDb: -121 }),
      invalidDocument("gain-out-of-range"),
    ],
    [
      "refuses a track without mute",
      withVoice({ muted: undefined }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses an unknown track field",
      withVoice({ pan: 0 }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses a clip of a source it doesn't list",
      withVoice({ clips: [{ ...a, source: "s9" }] }),
      invalidDocument("unknown-source"),
    ],
    [
      "refuses a clip past its source",
      withVoice({ clips: [{ ...a, end: 1_001 }] }),
      invalidDocument("clip-outside-source"),
    ],
  ];
  const generated = fc
    .sample(trackPlanArb, { seed: SEED, numRuns: GENERATED_PLANS })
    .map((state, index) =>
      make(
        `generated ${index + 1}: ${state.tracks.length} tracks`,
        toTrackPlanDocument(state, sources),
        readAndWriteTracks,
        applied,
      ),
    );
  return {
    format: "hm-conformance",
    version: 1,
    subject: "hm-audio-plan-2",
    description:
      "Reading hm-audio-plan documents as version 2 (docs/formats/hm-audio-plan.md, docs/adr/0006): input is a document of version 1 or 2, and expected is the version 2 document a reader writes back, or the rejection. A version 1 document comes back migrated.",
    cases: [
      ...handWritten.map(([name, input, outcome]) =>
        make(name, input, readAndWriteTracks, outcome),
      ),
      ...generated,
    ],
  };
}

/** `hm-audio-command-migration`: a version 1 command, migrated and applied. */
export function migrationCases(): ConformanceFile {
  const samples = fc
    .sample(
      planArb.chain((state) => fc.tuple(fc.constant(state), commandFor(state))),
      { seed: SEED, numRuns: 800 },
    )
    .map(([state, command]) => ({
      input: { plan: toAudioPlanDocument(state, sources), command },
      label: command.type,
    }));
  return {
    format: "hm-conformance",
    version: 1,
    subject: "hm-audio-command-migration",
    description:
      "Migrating version 1 commands (docs/formats/hm-audio-plan.md, docs/adr/0006). input.plan is an hm-audio-plan document of version 1 and input.command an hm-audio-command of version 1. The plan migrates to version 2, the command to the version 2 commands the format record lists, and they're applied in order; expected is the resulting version 2 document, or the first rejection. The migrated commands themselves aren't compared. Generated cases come from version 1's property-test generators, with a fixed seed.",
    cases: keepSome(samples, migrateAndApply, GENERATED_MIGRATIONS),
  };
}
