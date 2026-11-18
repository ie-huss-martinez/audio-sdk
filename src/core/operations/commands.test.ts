import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { commandFor, planArb, SOURCES } from "../../../test/arbitraries/audio-plan.js";
import { isAudioError } from "../errors/audio-error.js";
import {
  type AudioClip,
  type AudioPlan,
  type AudioTrack,
  assertClip,
  EMPTY_METADATA,
  NO_FADE,
  orderProblem,
  planLength,
} from "../model/plan.js";
import { type AudioCommand, type AudioCommandRejection, createPlanReducer } from "./commands.js";

const reduce = createPlanReducer((id) => (Object.hasOwn(SOURCES, id) ? SOURCES[id] : undefined));

/**
 * Timeouts for the property tests, which run thousands of cases. Measured
 * with the designed run counts on a 12-core machine: alone, and with the
 * whole unit suite running three times at once, which is busier than CI
 * and slows them about tenfold. Each timeout is over twice its busy time.
 * The run counts aren't lowered to fit a timeout.
 */
const SLOW = 120_000;

const clip = (
  key: string,
  at: number,
  start: number,
  end: number,
  extra: Partial<AudioClip> = {},
): AudioClip => ({
  key,
  at,
  source: "s1",
  start,
  end,
  gainDb: 0,
  fadeIn: NO_FADE,
  fadeOut: NO_FADE,
  ...extra,
});

const track = (key: string, ...clips: AudioClip[]): AudioTrack => ({
  key,
  name: "",
  gainDb: 0,
  muted: false,
  soloed: false,
  clips,
});

const plan = (...tracks: AudioTrack[]): AudioPlan => ({
  sampleRate: 48_000,
  channels: 2,
  gainDb: 0,
  tracks,
  metadata: EMPTY_METADATA,
});

/** Each track's clips as `key@at:start-end`. */
const layout = (state: AudioPlan) =>
  state.tracks.map((entry) =>
    entry.clips.map((c) => `${c.key}@${c.at}:${c.start}-${c.end}`).join(" "),
  );

/** Every clip valid within its source, each track in order without overlap, and every key once. */
function expectValid(state: AudioPlan): void {
  expect(state.tracks.length).toBeGreaterThan(0);
  const keys: string[] = [];
  for (const entry of state.tracks) {
    keys.push(entry.key);
    expect(orderProblem(entry.clips)).toBeUndefined();
    for (const c of entry.clips) {
      keys.push(c.key);
      assertClip(c, SOURCES[c.source] as number);
      expect(Number.isSafeInteger(c.at) && c.at >= 0).toBe(true);
    }
  }
  expect(new Set(keys).size).toBe(keys.length);
}

/** Applies a command, checks that its inverse restores the plan exactly, and returns the result. */
function roundTrip(state: AudioPlan, command: AudioCommand): AudioPlan {
  const { state: next, inverse } = reduce(state, command);
  expectValid(next);
  expect(structuredClone(inverse)).toEqual(inverse);
  const undone = reduce(next, inverse);
  expect(undone.state).toEqual(state);
  // And the inverse's own inverse does the command again.
  expect(reduce(undone.state, undone.inverse).state).toEqual(next);
  return next;
}

function reason(state: AudioPlan, command: unknown): AudioCommandRejection | undefined {
  try {
    reduce(state, command as AudioCommand);
  } catch (error) {
    if (!isAudioError(error, "INVALID_COMMAND")) throw error;
    return (error.details as { reason: AudioCommandRejection }).reason;
  }
  return undefined;
}

/** Voice: `a` at 0–100 and `b` at 150–250. Music: `m` at 50–350. */
const BASE = plan(
  track("voice", clip("a", 0, 0, 100), clip("b", 150, 200, 300)),
  track("music", clip("m", 50, 0, 300, { source: "s2" })),
);

describe("clip edits never move another clip", () => {
  it("inserts clips in free space, in any order", () => {
    const next = roundTrip(BASE, {
      type: "audio.insertClips",
      track: "voice",
      clips: [clip("d", 300, 0, 10), clip("c", 100, 0, 50)],
    });
    expect(layout(next)[0]).toBe("a@0:0-100 c@100:0-50 b@150:200-300 d@300:0-10");
    expect(layout(next)[1]).toBe(layout(BASE)[1]);
  });

  it("refuses an insert that would overlap, a taken key and an unknown track", () => {
    const insert = (extra: object, clips = [clip("c", 90, 0, 20)]) => ({
      type: "audio.insertClips",
      track: "voice",
      clips,
      ...extra,
    });
    expect(reason(BASE, insert({}))).toBe("clips-overlap");
    expect(reason(BASE, insert({}, [clip("c", 100, 0, 10), clip("d", 105, 0, 10)]))).toBe(
      "clips-overlap",
    );
    expect(reason(BASE, insert({}, [clip("m", 100, 0, 10)]))).toBe("key-taken");
    expect(reason(BASE, insert({}, [clip("voice", 100, 0, 10)]))).toBe("key-taken");
    expect(reason(BASE, insert({ track: "drums" }))).toBe("unknown-track");
    expect(reason(BASE, insert({}, []))).toBe("no-clips");
    expect(reason(BASE, insert({}, [{ ...clip("c", 100, 0, 10), at: -1 }]))).toBe("invalid-frames");
  });

  it("removes clips on several tracks, leaving silence", () => {
    const next = roundTrip(BASE, { type: "audio.removeClips", keys: ["m", "a"] });
    expect(layout(next)).toEqual(["b@150:200-300", ""]);
    expect(planLength(next)).toBe(250);
  });

  it("trims a clip's start, keeping its audio where it was", () => {
    const next = roundTrip(BASE, { type: "audio.trimClip", key: "b", start: 220, end: 300 });
    expect(layout(next)[0]).toBe("a@0:0-100 b@170:220-300");
    const earlier = roundTrip(BASE, { type: "audio.trimClip", key: "b", start: 160, end: 300 });
    expect(layout(earlier)[0]).toBe("a@0:0-100 b@110:160-300");
  });

  it("refuses a trim that would reach into a neighbour or before the timeline", () => {
    expect(reason(BASE, { type: "audio.trimClip", key: "b", start: 140, end: 300 })).toBe(
      "clips-overlap",
    );
    expect(reason(BASE, { type: "audio.trimClip", key: "a", start: 0, end: 160 })).toBe(
      "clips-overlap",
    );
    const late = plan(track("t", clip("a", 5, 10, 100)));
    expect(reason(late, { type: "audio.trimClip", key: "a", start: 0, end: 100 })).toBe(
      "frame-outside-plan",
    );
    expect(reason(BASE, { type: "audio.trimClip", key: "a", start: 0, end: 1_001 })).toBe(
      "clip-outside-source",
    );
  });

  it("shortens fades that no longer fit a trimmed clip", () => {
    const faded = plan(
      track(
        "t",
        clip("a", 0, 0, 100, {
          fadeIn: { frames: 40, curve: "linear" },
          fadeOut: { frames: 60, curve: "equalPower" },
        }),
      ),
    );
    const next = roundTrip(faded, { type: "audio.trimClip", key: "a", start: 0, end: 50 });
    expect(next.tracks[0]?.clips[0]).toMatchObject({
      fadeIn: { frames: 20 },
      fadeOut: { frames: 30 },
    });
  });

  it("splits a clip at a timeline frame, each part keeping the fade of its own edge", () => {
    const faded = plan(
      track(
        "t",
        clip("a", 20, 0, 100, {
          fadeIn: { frames: 10, curve: "linear" },
          fadeOut: { frames: 10, curve: "linear" },
        }),
      ),
    );
    const next = roundTrip(faded, { type: "audio.splitClip", key: "a", at: 60, newKey: "a2" });
    expect(layout(next)).toEqual(["a@20:0-40 a2@60:40-100"]);
    expect(next.tracks[0]?.clips.map((c) => [c.fadeIn.frames, c.fadeOut.frames])).toEqual([
      [10, 0],
      [0, 10],
    ]);
    for (const at of [20, 120]) {
      expect(reason(faded, { type: "audio.splitClip", key: "a", at, newKey: "a2" })).toBe(
        "not-inside-clip",
      );
    }
    expect(reason(faded, { type: "audio.splitClip", key: "a", at: 60, newKey: "t" })).toBe(
      "key-taken",
    );
  });

  it("moves clips in time and to another track, together", () => {
    const next = roundTrip(BASE, { type: "audio.moveClips", keys: ["b"], by: -50 });
    expect(layout(next)[0]).toBe("a@0:0-100 b@100:200-300");
    const across = roundTrip(BASE, {
      type: "audio.moveClips",
      keys: ["a", "b"],
      by: 400,
      track: "music",
    });
    expect(layout(across)).toEqual(["", "m@50:0-300 a@400:0-100 b@550:200-300"]);
    // Past a neighbour is fine, when there's room.
    const past = roundTrip(BASE, { type: "audio.moveClips", keys: ["a"], by: 250 });
    expect(layout(past)[0]).toBe("b@150:200-300 a@250:0-100");
  });

  it("refuses a move that would overlap, or start before the timeline", () => {
    expect(reason(BASE, { type: "audio.moveClips", keys: ["b"], by: -51 })).toBe("clips-overlap");
    expect(reason(BASE, { type: "audio.moveClips", keys: ["a"], by: 0, track: "music" })).toBe(
      "clips-overlap",
    );
    expect(reason(BASE, { type: "audio.moveClips", keys: ["a"], by: -1 })).toBe(
      "frame-outside-plan",
    );
    expect(reason(BASE, { type: "audio.moveClips", keys: ["a"], by: 1.5 })).toBe(
      "malformed-command",
    );
    expect(reason(BASE, { type: "audio.moveClips", keys: ["a"], by: 0, track: "x" })).toBe(
      "unknown-track",
    );
  });

  it("sets gains and fades as before", () => {
    const next = roundTrip(BASE, { type: "audio.setGain", keys: ["a", "m"], gainDb: -6.5 });
    expect(next.tracks.map((t) => t.clips[0]?.gainDb)).toEqual([-6.5, -6.5]);
    roundTrip(BASE, { type: "audio.setFade", key: "a", edge: "in", frames: 100, curve: "linear" });
    expect(
      reason(BASE, { type: "audio.setFade", key: "a", edge: "in", frames: 101, curve: "linear" }),
    ).toBe("fades-too-long");
    expect(reason(BASE, { type: "audio.setGain", keys: ["a"], gainDb: 121 })).toBe(
      "gain-out-of-range",
    );
  });
});

describe("time edits move what's after them, on the tracks they name", () => {
  it("deletes a range and leaves silence, without ripple", () => {
    const next = roundTrip(BASE, {
      type: "audio.deleteRange",
      start: 60,
      end: 200,
      tracks: ["voice", "music"],
      ripple: false,
      newKeys: { music: "m2" },
    });
    expect(layout(next)).toEqual(["a@0:0-60 b@200:250-300", "m@50:0-10 m2@200:150-300"]);
  });

  it("closes the gap with ripple, only on the named tracks", () => {
    const next = roundTrip(BASE, {
      type: "audio.deleteRange",
      start: 60,
      end: 200,
      tracks: ["voice"],
      ripple: true,
    });
    expect(layout(next)).toEqual(["a@0:0-60 b@60:250-300", "m@50:0-300"]);
    // A range in silence still moves what's after it.
    const silent = roundTrip(BASE, {
      type: "audio.deleteRange",
      start: 100,
      end: 150,
      tracks: ["voice"],
      ripple: true,
    });
    expect(layout(silent)[0]).toBe("a@0:0-100 b@100:200-300");
  });

  it("needs a new key where a range lies inside one clip, and only there", () => {
    const inside = {
      type: "audio.deleteRange",
      start: 100,
      end: 110,
      tracks: ["music"],
      ripple: true,
    };
    expect(reason(BASE, inside)).toBe("new-key-required");
    expect(reason(BASE, { ...inside, newKeys: { music: "a" } })).toBe("key-taken");
    expect(reason(BASE, { ...inside, newKeys: { voice: "x" } })).toBe("unknown-track");
    const next = roundTrip(BASE, { ...inside, newKeys: { music: "m2" } } as AudioCommand);
    expect(layout(next)[1]).toBe("m@50:0-50 m2@100:60-300");
    // An unused key isn't checked: the session passes one for every track.
    roundTrip(BASE, {
      type: "audio.deleteRange",
      start: 100,
      end: 150,
      tracks: ["voice"],
      ripple: false,
      newKeys: { voice: "a" },
    });
  });

  it("refuses ranges outside the plan, empty ranges and bad track lists", () => {
    const range = (extra: object) => ({
      type: "audio.deleteRange",
      start: 0,
      end: 10,
      tracks: ["voice"],
      ripple: true,
      ...extra,
    });
    expect(reason(BASE, range({ end: 351 }))).toBe("frame-outside-plan");
    expect(reason(BASE, range({ start: 10 }))).toBe("empty-range");
    expect(reason(BASE, range({ tracks: [] }))).toBe("no-tracks");
    expect(reason(BASE, range({ tracks: ["voice", "voice"] }))).toBe("duplicate-key");
    expect(reason(BASE, range({ tracks: ["drums"] }))).toBe("unknown-track");
    expect(reason(BASE, range({ ripple: 1 }))).toBe("malformed-command");
    expect(reason(BASE, range({ newKeys: ["x"] }))).toBe("malformed-command");
  });

  it("keeps a range on every track, moved to the start", () => {
    const next = roundTrip(BASE, { type: "audio.keepRange", start: 80, end: 200 });
    expect(layout(next)).toEqual(["a@0:80-100 b@70:200-250", "m@0:30-150"]);
    expect(planLength(next)).toBe(120);
  });

  it("opens time, splitting a clip that lies across the frame", () => {
    const next = roundTrip(BASE, {
      type: "audio.insertTime",
      at: 100,
      frames: 30,
      tracks: ["voice", "music"],
      newKeys: { music: "m2" },
    });
    expect(layout(next)).toEqual(["a@0:0-100 b@180:200-300", "m@50:0-50 m2@130:50-300"]);
    expect(reason(BASE, { type: "audio.insertTime", at: 100, frames: 30, tracks: ["music"] })).toBe(
      "new-key-required",
    );
    expect(reason(BASE, { type: "audio.insertTime", at: 100, frames: 0, tracks: ["voice"] })).toBe(
      "invalid-frames",
    );
    expect(reason(BASE, { type: "audio.insertTime", at: 351, frames: 1, tracks: ["voice"] })).toBe(
      "frame-outside-plan",
    );
  });

  it("undoes a ripple over many clips with one number", () => {
    const many = plan(
      track("t", ...Array.from({ length: 50 }, (_, i) => clip(`c${i}`, i * 10, 0, 10))),
    );
    const { inverse } = reduce(many, {
      type: "audio.deleteRange",
      start: 0,
      end: 10,
      tracks: ["t"],
      ripple: true,
    });
    expect(inverse).toEqual({
      type: "audio.replaceClips",
      edits: [{ track: "t", index: 0, count: 0, clips: [clip("c0", 0, 0, 10)], shift: 10 }],
    });
  });
});

describe("tracks", () => {
  it("adds, removes, moves and restores tracks", () => {
    const added = roundTrip(BASE, { type: "audio.addTrack", key: "fx", index: 1, name: "Effects" });
    expect(added.tracks.map((t) => t.key)).toEqual(["voice", "fx", "music"]);
    expect(added.tracks[1]).toEqual({ ...track("fx"), name: "Effects" });
    const moved = roundTrip(added, { type: "audio.moveTrack", key: "voice", to: 2 });
    expect(moved.tracks.map((t) => t.key)).toEqual(["fx", "music", "voice"]);
    const removed = roundTrip(moved, { type: "audio.removeTracks", keys: ["voice", "fx"] });
    expect(removed.tracks.map((t) => t.key)).toEqual(["music"]);
  });

  it("keeps at least one track, and refuses bad indexes, names and keys", () => {
    expect(reason(BASE, { type: "audio.removeTracks", keys: ["voice", "music"] })).toBe(
      "last-track",
    );
    expect(reason(BASE, { type: "audio.removeTracks", keys: [] })).toBe("no-tracks");
    expect(reason(BASE, { type: "audio.addTrack", key: "a", index: 0 })).toBe("key-taken");
    expect(reason(BASE, { type: "audio.addTrack", key: "fx", index: 3 })).toBe("invalid-index");
    expect(
      reason(BASE, { type: "audio.addTrack", key: "fx", index: 0, name: "🎵".repeat(101) }),
    ).toBe("name-too-long");
    roundTrip(BASE, { type: "audio.addTrack", key: "fx", index: 0, name: "🎵".repeat(100) });
    expect(reason(BASE, { type: "audio.moveTrack", key: "voice", to: 2 })).toBe("invalid-index");
  });

  it("sets only the fields given of a track, and undoes only those", () => {
    const next = roundTrip(BASE, {
      type: "audio.setTrack",
      key: "music",
      gainDb: -12,
      muted: true,
    });
    expect(next.tracks[1]).toMatchObject({ gainDb: -12, muted: true, soloed: false, name: "" });
    expect(reduce(BASE, { type: "audio.setTrack", key: "music", soloed: true }).inverse).toEqual({
      type: "audio.setTrack",
      key: "music",
      soloed: false,
    });
    expect(reason(BASE, { type: "audio.setTrack", key: "music" })).toBe("empty-change");
    expect(reason(BASE, { type: "audio.setTrack", key: "music", muted: "yes" })).toBe(
      "malformed-command",
    );
    expect(reason(BASE, { type: "audio.setTrack", key: "music", gainDb: 121 })).toBe(
      "gain-out-of-range",
    );
  });

  it("sets the master gain and the channel count", () => {
    expect(roundTrip(BASE, { type: "audio.setMasterGain", gainDb: -3 }).gainDb).toBe(-3);
    expect(roundTrip(BASE, { type: "audio.setChannels", channels: 1 }).channels).toBe(1);
    expect(reason(BASE, { type: "audio.setChannels", channels: 0 })).toBe("malformed-command");
    expect(reason(BASE, { type: "audio.setMasterGain", gainDb: Number.NaN })).toBe(
      "gain-out-of-range",
    );
  });
});

describe("the reducer", () => {
  it("is strict about shapes", () => {
    expect(reason(BASE, null)).toBe("malformed-command");
    expect(reason(BASE, { type: "audio.reorderClips", order: [] })).toBe("unknown-command");
    expect(reason(BASE, { type: "toString" })).toBe("unknown-command");
    expect(reason(BASE, { type: "audio.removeClips", keys: ["a"], ripple: true })).toBe(
      "malformed-command",
    );
    expect(
      reason(BASE, {
        type: "audio.insertClips",
        track: "voice",
        clips: [{ ...clip("c", 300, 0, 10), muted: true }],
      }),
    ).toBe("malformed-command");
  });

  it("refuses internal commands that would break a track's order or reuse a key", () => {
    expect(
      reason(BASE, {
        type: "audio.replaceClips",
        edits: [{ track: "voice", index: 1, count: 0, clips: [clip("z", 50, 0, 10)], shift: 0 }],
      }),
    ).toBe("clips-overlap");
    expect(
      reason(BASE, {
        type: "audio.replaceClips",
        edits: [{ track: "voice", index: 2, count: 0, clips: [clip("m", 300, 0, 10)], shift: 0 }],
      }),
    ).toBe("duplicate-key");
    expect(
      reason(BASE, {
        type: "audio.updateClips",
        clips: [{ ...clip("a", 300, 0, 100) }],
      }),
    ).toBe("clips-out-of-order");
    expect(
      reason(BASE, {
        type: "audio.restoreTracks",
        entries: [{ index: 0, track: track("voice") }],
      }),
    ).toBe("duplicate-key");
  });

  it("treats tracks and clips named like Object.prototype's properties as data", () => {
    const odd = plan(track("__proto__", clip("constructor", 0, 0, 100)), track("toString"));
    const next = roundTrip(odd, {
      type: "audio.deleteRange",
      start: 10,
      end: 20,
      tracks: ["__proto__"],
      ripple: false,
      newKeys: JSON.parse('{"__proto__":"valueOf"}') as Record<string, string>,
    });
    expect(layout(next)[0]).toBe("constructor@0:0-10 valueOf@20:20-100");
    expect(reason(odd, { type: "audio.removeTracks", keys: ["hasOwnProperty"] })).toBe(
      "unknown-track",
    );
  });

  it(
    "keeps every plan valid, and undoes every command exactly",
    () => {
      fc.assert(
        fc.property(
          planArb.chain((state) => fc.tuple(fc.constant(state), commandFor(state))),
          ([state, command]) => {
            expectValid(state);
            const before = structuredClone(state);
            let applied = true;
            try {
              roundTrip(state, command);
            } catch (error) {
              if (!isAudioError(error, "INVALID_COMMAND")) throw error;
              applied = false;
            }
            // Applied or refused, the plan it was given is untouched.
            expect(state).toEqual(before);
            return applied || true;
          },
        ),
        { numRuns: 3_000 },
      );
      // 4.3 s alone, 47 s busy.
    },
    SLOW,
  );

  it(
    "applies most generated commands, so the property isn't vacuous",
    () => {
      let applied = 0;
      const kinds = new Set<string>();
      fc.assert(
        fc.property(
          planArb.chain((state) => fc.tuple(fc.constant(state), commandFor(state))),
          ([state, command]) => {
            try {
              reduce(state, command);
              applied += 1;
              kinds.add(command.type);
            } catch {
              // Refused: counted by its absence.
            }
          },
        ),
        { numRuns: 3_000, seed: 6 },
      );
      expect(applied).toBeGreaterThan(600);
      expect(kinds.size).toBe(16);
      // 1.2 s alone, 11 s busy.
    },
    SLOW / 2,
  );
});
