import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { commandFor, planArb } from "../../../test/arbitraries/audio-plan.js";
import { SOURCES, trackPlanArb } from "../../../test/arbitraries/track-plan.js";
import { isAudioError } from "../errors/audio-error.js";
import { type AudioClip, type AudioPlan, EMPTY_METADATA, NO_FADE } from "../model/plan.js";
import { orderProblem, trackPlanLength } from "../model/tracks.js";
import { type AudioCommand, createPlanReducer } from "../operations/commands.js";
import { createTrackPlanReducer } from "../operations/track-commands.js";
import { toAudioPlanDocument } from "./plan-document.js";
import {
  migrateCommand,
  migratePlan,
  readTrackPlanDocument,
  toTrackPlanDocument,
} from "./track-plan-document.js";

const sources = Object.fromEntries(Object.entries(SOURCES).map(([id, frames]) => [id, { frames }]));
const lookup = (id: string) => (Object.hasOwn(SOURCES, id) ? SOURCES[id] : undefined);
const reduceV1 = createPlanReducer(lookup);
const reduce = createTrackPlanReducer(lookup);

const clip = (
  key: string,
  start: number,
  end: number,
  extra: Partial<AudioClip> = {},
): AudioClip => ({
  key,
  source: "s1",
  start,
  end,
  gainDb: 0,
  fadeIn: NO_FADE,
  fadeOut: NO_FADE,
  ...extra,
});

const v1 = (...clips: AudioClip[]): AudioPlan => ({
  sampleRate: 48_000,
  channels: 2,
  clips,
  metadata: { ...EMPTY_METADATA, title: "Take 1" },
});

/**
 * Timeouts for the property tests, which run thousands of cases. Measured
 * with the designed run counts on a 12-core machine: alone, and with the
 * whole unit suite running three times at once, which is busier than CI
 * and slows them about tenfold. Each timeout is over twice its busy time.
 * The run counts aren't lowered to fit a timeout.
 */
const SLOW = 120_000;

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
      fc.property(trackPlanArb, (plan) => {
        const document = toTrackPlanDocument(plan, sources);
        expect(document).toMatchObject({ format: "hm-audio-plan", version: 2 });
        const read = readTrackPlanDocument(JSON.parse(JSON.stringify(document)));
        expect(read.plan).toEqual(plan);
        expect(read.sources).toEqual(sources);
      }),
    );
  });

  it("refuse what a schema can't see: overlap, order, keys shared across tracks", () => {
    const base = toTrackPlanDocument(migratePlan(v1(clip("a", 0, 100), clip("b", 0, 50))), sources);
    const [track] = base.tracks;
    const [a, b] = track?.clips ?? [];
    const withClips = (clips: unknown[]) => ({ ...base, tracks: [{ ...track, clips }] });
    const reasonOf = (document: unknown) => refusal(() => readTrackPlanDocument(document));
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
    expect(() => toTrackPlanDocument(migratePlan(v1(clip("a", 0, 10))), {})).toThrow(TypeError);
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
      fc.property(planArb, (plan) => {
        const document = JSON.parse(JSON.stringify(toAudioPlanDocument(plan, sources)));
        const read = readTrackPlanDocument(document).plan;
        expect(read).toEqual(migratePlan(plan));
        expect(orderProblem(read.tracks[0]?.clips ?? [])).toBeUndefined();
      }),
    );
  });

  it("refuses a version 1 document for version 1's reasons", () => {
    const document = { ...toAudioPlanDocument(v1(clip("a", 0, 100)), sources), tracks: [] };
    expect(refusal(() => readTrackPlanDocument(document))).toEqual({
      code: "INVALID_DOCUMENT",
      reason: "malformed-document",
    });
  });
});

describe("migrating version 1 commands", () => {
  /** A version 1 command run by version 1's reducer, then migrated: or the refusal. */
  const earlier = (plan: AudioPlan, command: AudioCommand) => {
    try {
      return migratePlan(reduceV1(plan, command).state);
    } catch (error) {
      if (!isAudioError(error, "INVALID_COMMAND")) throw error;
      return "refused";
    }
  };
  /** The same command migrated, then run by the multitrack reducer. */
  const later = (plan: AudioPlan, command: AudioCommand) => {
    let state = migratePlan(plan);
    try {
      for (const migrated of migrateCommand(command, state)) {
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

  it.each<[string, AudioCommand]>([
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
          planArb.chain((plan) => fc.tuple(fc.constant(plan), commandFor(plan))),
          ([plan, command]) => {
            expect(later(plan, command)).toEqual(earlier(plan, command));
          },
        ),
        { numRuns: 3_000 },
      );
      // 3.4 s alone, 32 s busy.
    },
    SLOW,
  );

  it(
    "leaves a migrated plan back to back, so later version 1 commands still mean the same",
    () => {
      fc.assert(
        fc.property(
          planArb.chain((plan) =>
            fc.tuple(fc.constant(plan), fc.array(commandFor(plan), { maxLength: 4 })),
          ),
          ([plan, commands]) => {
            let state = migratePlan(plan);
            for (const command of commands) {
              try {
                let next = state;
                for (const migrated of migrateCommand(command, state)) {
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
            expect(trackPlanLength(state)).toBe(at);
          },
        ),
        { numRuns: 500 },
      );
      // 0.5 s alone, 5.5 s busy.
    },
    SLOW / 4,
  );

  it("refuses commands that aren't version 1's, and clips the plan doesn't have", () => {
    const plan = migratePlan(BASE);
    const reasonOf = (command: unknown) => refusal(() => migrateCommand(command, plan))?.reason;
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
