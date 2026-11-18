import fc from "fast-check";
import {
  type AudioTrack,
  type AudioTrackClip,
  type AudioTrackPlan,
  trackPlanLength,
} from "../../src/core/model/tracks.js";
import type { AudioTrackUserCommand } from "../../src/core/operations/track-commands.js";
import { EMPTY_METADATA } from "../../src/index.js";
import { SOURCES } from "./audio-plan.js";

/**
 * Generators of multitrack plans and of commands aimed at them
 * (docs/adr/0006), shared by the reducer's property tests and the
 * conformance vectors they seed (sdk-core ADR 0045).
 */

export { SOURCES };

const CLIP_KEYS = ["a", "b", "c", "d", "e", "f", "g", "h"];
const TRACK_KEYS = ["t1", "t2", "t3"];
/** Keys a command may name: the plan's, and some it doesn't have. */
export const anyKey = fc.constantFrom(...CLIP_KEYS, ...TRACK_KEYS, "x", "y");
const curve = fc.constantFrom("linear" as const, "equalPower" as const);

/** A clip without its key and position: valid within its source by construction. */
const clipBody = fc
  .record({
    source: fc.constantFrom("s1", "s2"),
    start: fc.integer({ min: 0, max: 400 }),
    length: fc.integer({ min: 1, max: 100 }),
    gainDb: fc.integer({ min: -20, max: 20 }),
    fadeIn: fc.record({ share: fc.double({ min: 0, max: 0.5, noNaN: true }), curve }),
    fadeOut: fc.record({ share: fc.double({ min: 0, max: 0.5, noNaN: true }), curve }),
  })
  .map(({ length, fadeIn, fadeOut, ...body }) => ({
    ...body,
    end: body.start + length,
    fadeIn: { frames: Math.floor(fadeIn.share * length), curve: fadeIn.curve },
    fadeOut: { frames: Math.floor(fadeOut.share * length), curve: fadeOut.curve },
  }));

/** A positioned clip with a key of its own choosing, for commands that add clips. */
export const trackClipArb = (key: fc.Arbitrary<string>): fc.Arbitrary<AudioTrackClip> =>
  fc
    .tuple(key, fc.integer({ min: 0, max: 600 }), clipBody)
    .map(([clipKey, at, body]) => ({ key: clipKey, at, ...body }));

/** A plan of one to three tracks, each with silence before some of its clips. */
export const trackPlanArb: fc.Arbitrary<AudioTrackPlan> = fc
  .record({
    tracks: fc.array(
      fc.record({
        gainDb: fc.integer({ min: -12, max: 12 }),
        muted: fc.boolean(),
        soloed: fc.boolean(),
        name: fc.constantFrom("", "Voice", "Music 🎵"),
        clips: fc.array(fc.tuple(fc.constantFrom(0, 0, 7, 40), clipBody), { maxLength: 3 }),
      }),
      { minLength: 1, maxLength: 3 },
    ),
    gainDb: fc.integer({ min: -6, max: 6 }),
  })
  .map(({ tracks, gainDb }) => {
    let next = 0;
    return {
      sampleRate: 48_000,
      channels: 2,
      gainDb,
      tracks: tracks.map((track, index): AudioTrack => {
        let at = 0;
        const clips: AudioTrackClip[] = [];
        for (const [gap, body] of track.clips) {
          const key = CLIP_KEYS[next];
          if (key === undefined) break;
          next += 1;
          at += gap;
          clips.push({ key, at, ...body });
          at += body.end - body.start;
        }
        return { ...track, key: TRACK_KEYS[index] as string, clips };
      }),
      metadata: EMPTY_METADATA,
    };
  });

/**
 * User-level commands aimed at a plan: mostly its own keys and frames
 * within it, with some that miss, so that both outcomes are common. Every
 * value is one JSON can carry.
 */
export const trackCommandFor = (state: AudioTrackPlan): fc.Arbitrary<AudioTrackUserCommand> => {
  const clipKeys = state.tracks.flatMap((track) => track.clips.map((clip) => clip.key));
  const trackKeys = state.tracks.map((track) => track.key);
  const clip = clipKeys.length > 0 ? fc.oneof(fc.constantFrom(...clipKeys), anyKey) : anyKey;
  const track = fc.oneof({ weight: 5, arbitrary: fc.constantFrom(...trackKeys) }, anyKey);
  const clips = fc.uniqueArray(clip, { minLength: 1, maxLength: 3 });
  const tracks = fc.uniqueArray(track, { minLength: 1, maxLength: 3 });
  const frame = fc.integer({ min: 0, max: trackPlanLength(state) + 2 });
  const newKeys = fc.option(
    fc
      .uniqueArray(fc.tuple(track, anyKey), { maxLength: 3, selector: ([name]) => name })
      .map((entries) => Object.fromEntries(entries)),
    { nil: undefined },
  );
  const optional = <T>(arbitrary: fc.Arbitrary<T>) => fc.option(arbitrary, { nil: undefined });
  /** Leaves out the fields that are `undefined`, as JSON does. */
  const clean = <T extends object>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  return fc
    .oneof(
      fc.record({
        type: fc.constant("audio.insertClips" as const),
        track,
        clips: fc.uniqueArray(trackClipArb(anyKey), {
          minLength: 1,
          maxLength: 2,
          selector: (entry) => entry.key,
        }),
      }),
      fc.record({ type: fc.constant("audio.removeClips" as const), keys: clips }),
      fc.record({
        type: fc.constant("audio.trimClip" as const),
        key: clip,
        start: fc.integer({ min: 0, max: 600 }),
        end: fc.integer({ min: 0, max: 600 }),
      }),
      fc.record({
        type: fc.constant("audio.splitClip" as const),
        key: clip,
        at: frame,
        newKey: anyKey,
      }),
      fc.record({
        type: fc.constant("audio.moveClips" as const),
        keys: clips,
        by: fc.integer({ min: -120, max: 300 }),
        track: optional(track),
      }),
      fc.record({
        type: fc.constant("audio.setGain" as const),
        keys: clips,
        gainDb: fc.double({ min: -130, max: 130, noNaN: true, noDefaultInfinity: true }),
      }),
      fc.record({
        type: fc.constant("audio.setFade" as const),
        key: clip,
        edge: fc.constantFrom("in" as const, "out" as const),
        frames: fc.integer({ min: 0, max: 120 }),
        curve,
      }),
      fc.record({
        type: fc.constant("audio.deleteRange" as const),
        start: frame,
        end: frame,
        tracks,
        ripple: fc.boolean(),
        newKeys,
      }),
      fc.record({ type: fc.constant("audio.keepRange" as const), start: frame, end: frame }),
      fc.record({
        type: fc.constant("audio.insertTime" as const),
        at: frame,
        frames: fc.integer({ min: 0, max: 50 }),
        tracks,
        newKeys,
      }),
      fc.record({
        type: fc.constant("audio.addTrack" as const),
        key: anyKey,
        index: fc.integer({ min: 0, max: 4 }),
        name: optional(fc.constantFrom("", "Effects", "x".repeat(101))),
      }),
      fc.record({ type: fc.constant("audio.removeTracks" as const), keys: tracks }),
      fc.record({
        type: fc.constant("audio.moveTrack" as const),
        key: track,
        to: fc.integer({ min: 0, max: 3 }),
      }),
      fc.record({
        type: fc.constant("audio.setTrack" as const),
        key: track,
        name: optional(fc.constantFrom("", "Voice")),
        gainDb: optional(fc.integer({ min: -130, max: 130 })),
        muted: optional(fc.boolean()),
        soloed: optional(fc.boolean()),
      }),
      fc.record({
        type: fc.constant("audio.setMasterGain" as const),
        gainDb: fc.double({ min: -130, max: 130, noNaN: true, noDefaultInfinity: true }),
      }),
      fc.record({
        type: fc.constant("audio.setChannels" as const),
        channels: fc.integer({ min: 0, max: 8 }),
      }),
    )
    .map((command) => clean(command) as AudioTrackUserCommand);
};
