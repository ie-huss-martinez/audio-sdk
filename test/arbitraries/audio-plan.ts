import fc from "fast-check";
import type { AudioClip, AudioCommand, AudioPlan } from "../../src/index.js";
import { EMPTY_METADATA, planLength } from "../../src/index.js";

/**
 * Generators of clip plans and of commands aimed at them, shared by the
 * reducer's property test and the conformance vectors it seeds (sdk-core
 * ADR 0045).
 */

/** The sources every generated plan draws from, by id, with their lengths in frames. */
export const SOURCES: Readonly<Record<string, number>> = { s1: 1_000, s2: 500 };

export const key = fc.constantFrom("a", "b", "c", "d", "e", "f", "g", "h");
const curve = fc.constantFrom("linear" as const, "equalPower" as const);

/** A clip that's valid by construction, so most commands have something to act on. */
export const clipArb = (clipKey: fc.Arbitrary<string>): fc.Arbitrary<AudioClip> =>
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

export const plan = (...clips: AudioClip[]): AudioPlan => ({
  sampleRate: 48_000,
  channels: 2,
  clips,
  metadata: EMPTY_METADATA,
});

export const planArb: fc.Arbitrary<AudioPlan> = fc
  .uniqueArray(clipArb(key), { maxLength: 5, selector: (entry) => entry.key })
  .map((clips) => plan(...clips));

/**
 * User-level commands aimed at a plan: mostly its own keys and frames within
 * it, with some that miss, so that both outcomes are common. Every value is
 * one JSON can carry.
 */
export const commandFor = (state: AudioPlan): fc.Arbitrary<AudioCommand> => {
  const own = state.clips.map((clip) => clip.key);
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
      gainDb: fc.double({ min: -130, max: 130, noNaN: true, noDefaultInfinity: true }),
    }),
    fc.record({
      type: fc.constant("audio.setFade" as const),
      key: target,
      edge: fc.constantFrom("in" as const, "out" as const),
      frames: fc.integer({ min: 0, max: 120 }),
      curve,
    }),
  );
};
