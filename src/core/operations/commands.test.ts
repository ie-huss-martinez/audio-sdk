import { applyCommands } from "@hussmartinez/sdk-core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isAudioError } from "../errors/audio-error.js";
import {
  type AudioClip,
  type AudioPlan,
  assertClip,
  clipLength,
  EMPTY_METADATA,
  NO_FADE,
  planLength,
} from "../model/plan.js";
import {
  type AudioCommand,
  type AudioCommandRejection,
  createPlanReducer,
  MAX_METADATA_LENGTH,
} from "./commands.js";

const SOURCES: Record<string, number> = { s1: 1_000, s2: 500 };
const reduce = createPlanReducer((id) => SOURCES[id]);

const clip = (key: string, start: number, end: number, extra: Partial<AudioClip> = {}) =>
  ({
    key,
    source: "s1",
    start,
    end,
    gainDb: 0,
    fadeIn: NO_FADE,
    fadeOut: NO_FADE,
    ...extra,
  }) satisfies AudioClip;

const plan = (...clips: AudioClip[]): AudioPlan => ({
  sampleRate: 48_000,
  channels: 2,
  clips,
  metadata: EMPTY_METADATA,
});

const keys = (state: AudioPlan) => state.clips.map((entry) => entry.key);
const ranges = (state: AudioPlan) =>
  state.clips.map((entry) => [entry.key, entry.start, entry.end]);

/** Every clip valid within its source, and every key once. */
function expectValid(state: AudioPlan): void {
  for (const entry of state.clips) assertClip(entry, SOURCES[entry.source] as number);
  expect(new Set(keys(state)).size).toBe(state.clips.length);
}

/** Applies a command, checks that its inverse restores the plan exactly, and returns the result. */
function roundTrip(state: AudioPlan, command: AudioCommand): AudioPlan {
  const { state: next, inverse } = reduce(state, command);
  expectValid(next);
  expect(structuredClone(inverse)).toEqual(inverse);
  expect(reduce(next, inverse).state).toEqual(state);
  return next;
}

/** Expects the command to be refused with `INVALID_COMMAND` and this reason. */
function expectInvalid(state: AudioPlan, command: unknown, reason: AudioCommandRejection): void {
  let thrown: unknown;
  try {
    reduce(state, command as AudioCommand);
  } catch (error) {
    thrown = error;
  }
  expect(isAudioError(thrown, "INVALID_COMMAND")).toBe(true);
  expect(thrown).toHaveProperty("details.reason", reason);
}

const ab = plan(clip("a", 0, 100), clip("b", 200, 300, { source: "s2" }));

describe("the clip plan reducer", () => {
  it("inserts clips between clips", () => {
    const next = roundTrip(ab, { type: "audio.insertClips", at: 100, clips: [clip("c", 0, 10)] });
    expect(keys(next)).toEqual(["a", "c", "b"]);
    expect(
      keys(roundTrip(ab, { type: "audio.insertClips", at: 200, clips: [clip("c", 0, 10)] })),
    ).toEqual(["a", "b", "c"]);
  });

  it("splits the clip an insert falls inside, keeping each fade on its own edge", () => {
    const faded = plan(
      clip("a", 0, 100, {
        fadeIn: { frames: 30, curve: "equalPower" },
        fadeOut: { frames: 30, curve: "linear" },
      }),
    );
    const next = roundTrip(faded, {
      type: "audio.insertClips",
      at: 40,
      clips: [clip("c", 0, 10)],
      splitKey: "a2",
    });
    expect(ranges(next)).toEqual([
      ["a", 0, 40],
      ["c", 0, 10],
      ["a2", 40, 100],
    ]);
    expect(next.clips[0]?.fadeIn).toEqual({ frames: 30, curve: "equalPower" });
    expect(next.clips[0]?.fadeOut).toEqual(NO_FADE);
    expect(next.clips[2]?.fadeIn).toEqual(NO_FADE);
    expect(next.clips[2]?.fadeOut).toEqual({ frames: 30, curve: "linear" });
    expectInvalid(
      faded,
      { type: "audio.insertClips", at: 40, clips: [clip("c", 0, 10)] },
      "new-key-required",
    );
  });

  it("removes clips, and restores them where they were", () => {
    const abc = plan(clip("a", 0, 10), clip("b", 10, 20), clip("c", 20, 30));
    expect(keys(roundTrip(abc, { type: "audio.removeClips", keys: ["c", "a"] }))).toEqual(["b"]);
    expect(roundTrip(abc, { type: "audio.removeClips", keys: ["a", "b", "c"] }).clips).toEqual([]);
  });

  it("deletes a range across clips, trimming the clips at its edges", () => {
    const next = roundTrip(ab, { type: "audio.deleteRange", start: 50, end: 150 });
    expect(ranges(next)).toEqual([
      ["a", 0, 50],
      ["b", 250, 300],
    ]);
    expect(planLength(next)).toBe(planLength(ab) - 100);
  });

  it("deletes whole clips when a range covers them exactly", () => {
    expect(ranges(roundTrip(ab, { type: "audio.deleteRange", start: 0, end: 100 }))).toEqual([
      ["b", 200, 300],
    ]);
    expect(roundTrip(ab, { type: "audio.deleteRange", start: 0, end: 200 }).clips).toEqual([]);
  });

  it("splits a clip when a deleted range is inside it, with newKey for the rest", () => {
    const next = roundTrip(ab, {
      type: "audio.deleteRange",
      start: 10,
      end: 20,
      newKey: "a2",
    });
    expect(ranges(next)).toEqual([
      ["a", 0, 10],
      ["a2", 20, 100],
      ["b", 200, 300],
    ]);
    expectInvalid(ab, { type: "audio.deleteRange", start: 10, end: 20 }, "new-key-required");
    expectInvalid(ab, { type: "audio.deleteRange", start: 10, end: 20, newKey: "b" }, "key-taken");
  });

  it("trims a clip, shortening fades that no longer fit in proportion", () => {
    const faded = plan(
      clip("a", 0, 100, {
        fadeIn: { frames: 60, curve: "linear" },
        fadeOut: { frames: 30, curve: "linear" },
      }),
    );
    const next = roundTrip(faded, { type: "audio.trimClip", key: "a", start: 10, end: 55 });
    expect(next.clips[0]?.fadeIn.frames).toBe(30);
    expect(next.clips[0]?.fadeOut.frames).toBe(15);
    expectInvalid(
      faded,
      { type: "audio.trimClip", key: "a", start: 10, end: 10 },
      "clip-too-short",
    );
    expectInvalid(
      faded,
      { type: "audio.trimClip", key: "a", start: 0, end: 1_001 },
      "clip-outside-source",
    );
  });

  it("splits a clip at a frame strictly inside it", () => {
    const next = roundTrip(ab, { type: "audio.splitClip", key: "b", at: 130, newKey: "b2" });
    expect(ranges(next)).toEqual([
      ["a", 0, 100],
      ["b", 200, 230],
      ["b2", 230, 300],
    ]);
    // 100 is the clip's own start, 200 the plan's end, 50 inside another clip.
    for (const at of [100, 200, 50]) {
      expectInvalid(ab, { type: "audio.splitClip", key: "b", at, newKey: "b2" }, "not-inside-clip");
    }
    expectInvalid(
      ab,
      { type: "audio.splitClip", key: "b", at: 201, newKey: "b2" },
      "frame-outside-plan",
    );
    expectInvalid(ab, { type: "audio.splitClip", key: "b", at: 130, newKey: "a" }, "key-taken");
  });

  it("moves clips as a block, and reorders them back", () => {
    const abc = plan(clip("a", 0, 10), clip("b", 10, 20), clip("c", 20, 30));
    expect(keys(roundTrip(abc, { type: "audio.moveClips", keys: ["c", "a"], to: 1 }))).toEqual([
      "b",
      "a",
      "c",
    ]);
    expectInvalid(abc, { type: "audio.moveClips", keys: ["a"], to: 3 }, "invalid-index");
    expectInvalid(abc, { type: "audio.reorderClips", order: ["a", "b", "b"] }, "invalid-order");
  });

  it("sets gains and fades", () => {
    const next = roundTrip(ab, { type: "audio.setGain", keys: ["a", "b"], gainDb: -6 });
    expect(next.clips.map((entry) => entry.gainDb)).toEqual([-6, -6]);
    const faded = roundTrip(ab, {
      type: "audio.setFade",
      key: "a",
      edge: "out",
      frames: 100,
      curve: "equalPower",
    });
    expect(faded.clips[0]?.fadeOut).toEqual({ frames: 100, curve: "equalPower" });
    for (const gainDb of [Number.NaN, Number.POSITIVE_INFINITY, 121, -121]) {
      expectInvalid(ab, { type: "audio.setGain", keys: ["a"], gainDb }, "gain-out-of-range");
    }
    expectInvalid(
      faded,
      { type: "audio.setFade", key: "a", edge: "in", frames: 1, curve: "linear" },
      "fades-too-long",
    );
    expectInvalid(
      ab,
      { type: "audio.setFade", key: "a", edge: "in", frames: 1, curve: "cubic" },
      "invalid-fade-curve",
    );
    expectInvalid(
      ab,
      { type: "audio.setFade", key: "a", edge: "middle", frames: 1, curve: "linear" },
      "invalid-edge",
    );
  });

  it("sets metadata fields, within a length limit", () => {
    const next = roundTrip(ab, { type: "audio.setMetadata", field: "title", value: "Take 2" });
    expect(next.metadata.title).toBe("Take 2");
    expectInvalid(
      ab,
      { type: "audio.setMetadata", field: "title", value: "x".repeat(MAX_METADATA_LENGTH + 1) },
      "metadata-too-long",
    );
    expectInvalid(
      ab,
      { type: "audio.setMetadata", field: "toString", value: "" },
      "unknown-metadata-field",
    );
  });

  it("refuses clips outside their source, of unknown sources, or with taken keys", () => {
    const insert = (entry: AudioClip) => ({ type: "audio.insertClips", at: 0, clips: [entry] });
    expectInvalid(ab, insert(clip("c", 0, 501, { source: "s2" })), "clip-outside-source");
    expectInvalid(ab, insert(clip("c", 0, 10, { source: "missing" })), "unknown-source");
    expectInvalid(ab, insert(clip("a", 0, 10)), "key-taken");
    expectInvalid(ab, insert(clip("c", 5, 5)), "clip-too-short");
    expectInvalid(ab, insert(clip("c", 0.5, 5)), "invalid-frames");
    expectInvalid(
      ab,
      insert(clip("c", 0, 10, { fadeIn: { frames: 11, curve: "linear" } })),
      "fades-too-long",
    );
  });

  it("refuses malformed commands without changing the plan", () => {
    for (const [command, reason] of [
      [null, "malformed-command"],
      [{}, "unknown-command"],
      [{ type: "audio.unknown" }, "unknown-command"],
      [{ type: "audio.removeClips" }, "malformed-command"],
      [{ type: "audio.removeClips", keys: [] }, "no-clips"],
      [{ type: "audio.removeClips", keys: ["a", "a"] }, "duplicate-key"],
      [{ type: "audio.removeClips", keys: ["z"] }, "unknown-clip"],
      [{ type: "audio.insertClips", at: 0, clips: [{ key: "c" }] }, "malformed-command"],
      [{ type: "audio.insertClips", at: 0, clips: [] }, "no-clips"],
      [
        { type: "audio.insertClips", at: 0, clips: [clip("c", 0, 1), clip("c", 1, 2)] },
        "duplicate-key",
      ],
      [{ type: "audio.insertClips", at: -1, clips: [clip("c", 0, 1)] }, "frame-outside-plan"],
      [{ type: "audio.insertClips", at: 0.5, clips: [clip("c", 0, 1)] }, "frame-outside-plan"],
      [
        { type: "audio.restoreClips", entries: [{ index: 5, clip: clip("c", 0, 1) }] },
        "invalid-index",
      ],
      [{ type: "audio.replaceClips", index: 1, count: 2, clips: [] }, "invalid-index"],
      [{ type: "audio.replaceClips", index: 1, count: 0, clips: [] }, "empty-change"],
      [{ type: "audio.updateClips", clips: [clip("z", 0, 1)] }, "unknown-clip"],
      [{ type: "audio.deleteRange", start: 0, end: 201 }, "frame-outside-plan"],
      [{ type: "audio.deleteRange", start: 5, end: 5 }, "empty-range"],
      [{ type: "audio.setMetadata", field: "title", value: 5 }, "malformed-command"],
    ] as const) {
      expectInvalid(ab, command, reason);
    }
  });

  it("names the command and the reason in the error's details, and nothing from the command", () => {
    expect(() => reduce(ab, { type: "audio.removeClips", keys: ["secret"] })).toThrow(
      expect.objectContaining({
        code: "INVALID_COMMAND",
        details: { command: "audio.removeClips", reason: "unknown-clip" },
      }),
    );
    // A type that isn't a command's is never echoed back.
    expect(() => reduce(ab, { type: "<script>" } as never)).toThrow(
      expect.objectContaining({ details: { reason: "unknown-command" } }),
    );
  });
});

describe("the clip plan reducer on arbitrary commands", () => {
  const key = fc.constantFrom("a", "b", "c", "d", "e", "f", "g", "h");
  const curve = fc.constantFrom("linear" as const, "equalPower" as const);
  /** A clip that's valid by construction, so most commands have something to act on. */
  const clipArb = (clipKey: fc.Arbitrary<string>) =>
    fc
      .record({
        key: clipKey,
        source: fc.constantFrom("s1", "s2"),
        start: fc.integer({ min: 0, max: 400 }),
        length: fc.integer({ min: 1, max: 100 }),
        gainDb: fc.integer({ min: -20, max: 20 }),
        fadeIn: fc.record({ share: fc.double({ min: 0, max: 0.5, noNaN: true }), curve }),
        fadeOut: fc.record({ share: fc.double({ min: 0, max: 0.5, noNaN: true }), curve }),
      })
      .map(
        ({ length, fadeIn, fadeOut, ...entry }): AudioClip => ({
          ...entry,
          end: entry.start + length,
          fadeIn: { frames: Math.floor(fadeIn.share * length), curve: fadeIn.curve },
          fadeOut: { frames: Math.floor(fadeOut.share * length), curve: fadeOut.curve },
        }),
      );
  const planArb = fc
    .uniqueArray(clipArb(key), { maxLength: 5, selector: (entry) => entry.key })
    .map((clips) => plan(...clips));
  /**
   * Commands aimed at a plan: mostly its own keys and frames within it, with
   * some that miss, so that both outcomes are common.
   */
  const commandFor = (state: AudioPlan): fc.Arbitrary<AudioCommand> => {
    const own = keys(state);
    const target = own.length > 0 ? fc.oneof(fc.constantFrom(...own), key) : key;
    const keyList = fc.uniqueArray(target, { minLength: 1, maxLength: 3 });
    const frames = fc.integer({ min: 0, max: planLength(state) + 2 });
    return fc.oneof(
      fc.record({
        type: fc.constant("audio.insertClips" as const),
        at: frames,
        clips: fc.uniqueArray(clipArb(key), { minLength: 1, maxLength: 2, selector: (c) => c.key }),
        splitKey: key,
      }),
      fc.record({ type: fc.constant("audio.removeClips" as const), keys: keyList }),
      fc.record({
        type: fc.constant("audio.deleteRange" as const),
        start: frames,
        end: frames,
        newKey: key,
      }),
      fc.record({
        type: fc.constant("audio.trimClip" as const),
        key: target,
        start: fc.integer({ min: 0, max: 600 }),
        end: fc.integer({ min: 0, max: 600 }),
      }),
      fc.record({
        type: fc.constant("audio.splitClip" as const),
        key: target,
        at: frames,
        newKey: key,
      }),
      fc.record({
        type: fc.constant("audio.moveClips" as const),
        keys: keyList,
        to: fc.integer({ min: 0, max: 5 }),
      }),
      fc.record({
        type: fc.constant("audio.setGain" as const),
        keys: keyList,
        gainDb: fc.double({ min: -130, max: 130 }),
      }),
      fc.record({
        type: fc.constant("audio.setFade" as const),
        key: target,
        edge: fc.constantFrom("in" as const, "out" as const),
        frames: fc.integer({ min: 0, max: 120 }),
        curve: fc.constantFrom("linear" as const, "equalPower" as const),
      }),
    );
  };

  it("either refuse a command with INVALID_COMMAND, or keep the plan valid and undo exactly", () => {
    fc.assert(
      fc.property(
        planArb.chain((state) =>
          fc.tuple(fc.constant(state), fc.array(commandFor(state), { minLength: 1, maxLength: 6 })),
        ),
        ([start, commands]) => {
          let state = start;
          const applied: AudioCommand[] = [];
          for (const next of commands) {
            let result: ReturnType<typeof reduce> | undefined;
            try {
              result = reduce(state, next);
            } catch (error) {
              expect(isAudioError(error, "INVALID_COMMAND")).toBe(true);
              expect(error).toHaveProperty(
                "details.reason",
                expect.stringMatching(/^[a-z]+(-[a-z]+)*$/),
              );
              continue;
            }
            expectValid(result.state);
            expect(reduce(result.state, result.inverse).state).toEqual(state);
            const length = planLength(result.state);
            if (next.type === "audio.deleteRange")
              expect(length).toBe(planLength(state) - (next.end - next.start));
            if (next.type === "audio.splitClip" || next.type === "audio.moveClips") {
              expect(length).toBe(planLength(state));
            }
            if (next.type === "audio.insertClips") {
              const added = next.clips.reduce((sum, entry) => sum + clipLength(entry), 0);
              expect(length).toBe(planLength(state) + added);
            }
            state = result.state;
            applied.push(next);
          }
          // Undoing the whole sequence, as one history step, restores the start.
          const { inverses } = applyCommands(reduce, start, applied);
          expect(applyCommands(reduce, state, inverses).state).toEqual(start);
        },
      ),
      { numRuns: 1_000 },
    );
  });
});
