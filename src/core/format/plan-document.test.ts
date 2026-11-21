import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planArb, SOURCES } from "../../../test/arbitraries/audio-plan.js";
import { commandFor as commandForV1, planArb as planArbV1 } from "../../../test/v1/arbitraries.js";
import {
  type AudioCommand as AudioCommandV1,
  createPlanReducer as createPlanReducerV1,
} from "../../../test/v1/commands.js";
import { toAudioPlanDocument as toDocumentV1 } from "../../../test/v1/plan-document.js";
import { isAudioError } from "../errors/audio-error.js";
import { EMPTY_METADATA, NO_FADE, orderProblem, planLength } from "../model/plan.js";
import { createPlanReducer } from "../operations/commands.js";
import { readAudioPlanDocument, toAudioPlanDocument } from "./plan-document.js";
import {
  type AudioClipV1,
  type AudioPlanV1,
  migrateAudioCommand,
  migratePlan,
} from "./version-1.js";

const sources = Object.fromEntries(Object.entries(SOURCES).map(([id, frames]) => [id, { frames }]));
const lookup = (id: string) => (Object.hasOwn(SOURCES, id) ? SOURCES[id] : undefined);
const reduceV1 = createPlanReducerV1(lookup);
const reduce = createPlanReducer(lookup);

const clip = (
  key: string,
  start: number,
  end: number,
  extra: Partial<AudioClipV1> = {},
): AudioClipV1 => ({
  key,
  source: "s1",
  start,
  end,
  gainDb: 0,
  fadeIn: NO_FADE,
  fadeOut: NO_FADE,
  ...extra,
});

const v1 = (...clips: AudioClipV1[]): AudioPlanV1 => ({
  sampleRate: 48_000,
  channels: 2,
  clips,
  metadata: { ...EMPTY_METADATA, title: "Take 1" },
});

function refusal(run: () => unknown): { code: string; reason: unknown } | undefined {
  try {
    run();
  } catch (error) {
    if (!isAudioError(error)) throw error;
    return { code: error.code, reason: (error.details as { reason?: unknown }).reason };
  }
  return undefined;
}

describe("version 2 documents", () => {
  it("round-trip every plan through JSON", () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        const document = toAudioPlanDocument(plan, sources);
        expect(document).toMatchObject({ format: "hm-audio-plan", version: 2 });
        const read = readAudioPlanDocument(JSON.parse(JSON.stringify(document)));
        expect(read.plan).toEqual(plan);
        expect(read.sources).toEqual(sources);
      }),
    );
  });

  it("refuse what a schema can't see: overlap, order, keys shared across tracks", () => {
    const base = toAudioPlanDocument(migratePlan(v1(clip("a", 0, 100), clip("b", 0, 50))), sources);
    const [track] = base.tracks;
    const [a, b] = track?.clips ?? [];
    const withClips = (clips: unknown[]) => ({ ...base, tracks: [{ ...track, clips }] });
    const reasonOf = (document: unknown) => refusal(() => readAudioPlanDocument(document));
    expect(reasonOf(withClips([a, { ...b, at: 99 }]))).toEqual({
      code: "INVALID_DOCUMENT",
      reason: "clips-overlap",
    });
    expect(reasonOf(withClips([b, a]))?.reason).toBe("clips-out-of-order");
    expect(reasonOf(withClips([a, { ...b, key: "t1" }]))?.reason).toBe("duplicate-key");
    expect(reasonOf({ ...base, tracks: [track, track] })?.reason).toBe("duplicate-key");
    expect(reasonOf({ ...base, tracks: [] })?.reason).toBe("no-tracks");
    expect(reasonOf({ ...base, tracks: [{ ...track, name: "x".repeat(101) }] })?.reason).toBe(
      "name-too-long",
    );
    expect(reasonOf({ ...base, gainDb: 121 })?.reason).toBe("gain-out-of-range");
    expect(reasonOf({ ...base, clips: [] })?.reason).toBe("malformed-document");
    expect(reasonOf({ ...base, tracks: [{ ...track, pan: 0 }] })?.reason).toBe(
      "malformed-document",
    );
    expect(reasonOf(withClips([{ ...a, at: 1.5 }]))?.reason).toBe("invalid-frames");
    expect(reasonOf({ ...base, version: 3 })).toEqual({
      code: "UNSUPPORTED_FORMAT",
      reason: "unknown-format-version",
    });
    expect(reasonOf({ ...base, format: "hm-video-plan" })?.reason).toBe("unknown-format");
  });

  it("throw TypeError when writing a clip whose source isn't listed", () => {
    expect(() => toAudioPlanDocument(migratePlan(v1(clip("a", 0, 10))), {})).toThrow(TypeError);
  });
});

describe("migrating version 1 plans", () => {
  it("puts the clips back to back on one track, under a master gain of 0 dB", () => {
    const plan = migratePlan(v1(clip("a", 0, 100, { gainDb: -3 }), clip("b", 200, 250)));
    expect(plan).toEqual({
      sampleRate: 48_000,
      channels: 2,
      gainDb: 0,
      tracks: [
        {
          key: "t1",
          name: "",
          gainDb: 0,
          muted: false,
          soloed: false,
          clips: [
            { ...clip("a", 0, 100, { gainDb: -3 }), at: 0 },
            { ...clip("b", 200, 250), at: 100 },
          ],
        },
      ],
      metadata: { ...EMPTY_METADATA, title: "Take 1" },
    });
  });

  it("names the track with the first of t1, t2… that no clip has", () => {
    expect(
      migratePlan(v1(clip("t1", 0, 1), clip("t3", 0, 1), clip("t2", 0, 1))).tracks[0]?.key,
    ).toBe("t4");
    expect(migratePlan(v1()).tracks[0]).toMatchObject({ key: "t1", clips: [] });
  });

  it("reads a version 1 document as the plan it migrates to", () => {
    fc.assert(
      fc.property(planArbV1, (plan) => {
        const document = JSON.parse(JSON.stringify(toDocumentV1(plan, sources)));
        const read = readAudioPlanDocument(document).plan;
        expect(read).toEqual(migratePlan(plan));
        expect(orderProblem(read.tracks[0]?.clips ?? [])).toBeUndefined();
      }),
    );
  });

  it("refuses a version 1 document for version 1's reasons", () => {
    const document = { ...toDocumentV1(v1(clip("a", 0, 100)), sources), tracks: [] };
    expect(refusal(() => readAudioPlanDocument(document))).toEqual({
      code: "INVALID_DOCUMENT",
      reason: "malformed-document",
    });
  });
});

/**
 * The limit of the one test here that's over the family's 30 s when the
 * machine is busy (sdk-core ADR 0057): it checks three thousand generated
 * version 1 commands against their migration. It took 3.4 s alone and 32 s
 * with the whole unit suite running three times at once on a 12-core
 * machine. The run count isn't lowered to fit the family's limit.
 */
const LONG = 120_000;

describe("migrating version 1 commands", () => {
  /** A version 1 command run by version 1's reducer, then migrated: or the refusal. */
  const earlier = (plan: AudioPlanV1, command: AudioCommandV1) => {
    try {
      return migratePlan(reduceV1(plan, command).state);
    } catch (error) {
      if (!isAudioError(error, "INVALID_COMMAND")) throw error;
      return "refused";
    }
  };
  /** The same command migrated, then run by the multitrack reducer. */
  const later = (plan: AudioPlanV1, command: AudioCommandV1) => {
    let state = migratePlan(plan);
    try {
      for (const migrated of migrateAudioCommand(command, state)) {
        state = reduce(state, migrated).state;
      }
    } catch (error) {
      if (!isAudioError(error, "INVALID_COMMAND")) throw error;
      return "refused";
    }
    return state;
  };

  const BASE = v1(
    clip("a", 0, 100, {
      fadeIn: { frames: 30, curve: "linear" },
      fadeOut: { frames: 30, curve: "linear" },
    }),
    clip("b", 200, 300),
    clip("c", 400, 450, { source: "s2" }),
  );

  it.each<[string, AudioCommandV1]>([
    ["an insert at a boundary", { type: "audio.insertClips", at: 100, clips: [clip("d", 0, 10)] }],
    [
      "an insert inside a clip",
      {
        type: "audio.insertClips",
        at: 150,
        clips: [clip("d", 0, 10), clip("e", 5, 9)],
        splitKey: "b2",
      },
    ],
    ["an insert at the end", { type: "audio.insertClips", at: 250, clips: [clip("d", 0, 10)] }],
    ["a removal of scattered clips", { type: "audio.removeClips", keys: ["c", "a"] }],
    ["a removal of every clip", { type: "audio.removeClips", keys: ["a", "b", "c"] }],
    ["a range across clips", { type: "audio.deleteRange", start: 50, end: 220 }],
    ["a range inside a clip", { type: "audio.deleteRange", start: 10, end: 20, newKey: "a2" }],
    ["a trim that shortens both ends", { type: "audio.trimClip", key: "b", start: 220, end: 280 }],
    ["a trim that lengthens both ends", { type: "audio.trimClip", key: "b", start: 150, end: 380 }],
    ["a trim that moves later", { type: "audio.trimClip", key: "b", start: 250, end: 340 }],
    ["a trim that moves earlier", { type: "audio.trimClip", key: "b", start: 120, end: 260 }],
    ["a trim of the first clip", { type: "audio.trimClip", key: "a", start: 40, end: 60 }],
    ["a trim of the last clip", { type: "audio.trimClip", key: "c", start: 380, end: 500 }],
    ["a split", { type: "audio.splitClip", key: "b", at: 130, newKey: "b2" }],
    ["a move to the start", { type: "audio.moveClips", keys: ["c", "b"], to: 0 }],
    ["a move to the end", { type: "audio.moveClips", keys: ["a"], to: 2 }],
    ["a move of every clip", { type: "audio.moveClips", keys: ["a", "b", "c"], to: 0 }],
    ["a gain", { type: "audio.setGain", keys: ["a", "c"], gainDb: -6 }],
    ["a fade", { type: "audio.setFade", key: "b", edge: "out", frames: 40, curve: "equalPower" }],
    ["metadata", { type: "audio.setMetadata", field: "artist", value: "Ana" }],
  ])("does what version 1 did: %s", (_, command) => {
    const expected = earlier(BASE, command);
    expect(expected).not.toBe("refused");
    expect(later(BASE, command)).toEqual(expected);
  });

  it(
    "does what version 1 did, or refuses what it refused, for any command",
    () => {
      fc.assert(
        fc.property(
          planArbV1.chain((plan) => fc.tuple(fc.constant(plan), commandForV1(plan))),
          ([plan, command]) => {
            expect(later(plan, command)).toEqual(earlier(plan, command));
          },
        ),
        { numRuns: 3_000 },
      );
      // 3.4 s alone, 32 s busy.
    },
    LONG,
  );

  it("leaves a migrated plan back to back, so later version 1 commands still mean the same", () => {
    fc.assert(
      fc.property(
        planArbV1.chain((plan) =>
          fc.tuple(fc.constant(plan), fc.array(commandForV1(plan), { maxLength: 4 })),
        ),
        ([plan, commands]) => {
          let state = migratePlan(plan);
          for (const command of commands) {
            try {
              let next = state;
              for (const migrated of migrateAudioCommand(command, state)) {
                next = reduce(next, migrated).state;
              }
              state = next;
            } catch (error) {
              if (!isAudioError(error, "INVALID_COMMAND")) throw error;
            }
          }
          const [track] = state.tracks;
          let at = 0;
          for (const entry of track?.clips ?? []) {
            expect(entry.at).toBe(at);
            at += entry.end - entry.start;
          }
          expect(planLength(state)).toBe(at);
        },
      ),
      { numRuns: 500 },
    );
    // 0.5 s alone, 5.5 s busy.
  });

  it("refuses commands that aren't version 1's, and clips the plan doesn't have", () => {
    const plan = migratePlan(BASE);
    const reasonOf = (command: unknown) =>
      refusal(() => migrateAudioCommand(command, plan))?.reason;
    expect(reasonOf(null)).toBe("malformed-command");
    expect(reasonOf({ type: "audio.keepRange", start: 0, end: 1 })).toBe("unknown-command");
    expect(reasonOf({ type: "audio.restoreClips", entries: [] })).toBe("unknown-command");
    expect(reasonOf({ type: "audio.removeClips", keys: ["z"] })).toBe("unknown-clip");
    expect(reasonOf({ type: "audio.moveClips", keys: ["a"], to: 3 })).toBe("invalid-index");
    expect(reasonOf({ type: "audio.removeClips", keys: ["a"], ripple: true })).toBe(
      "malformed-command",
    );
  });
});
