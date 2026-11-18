import type { Reducer } from "@hussmartinez/sdk-core";
import { AudioError } from "../errors/audio-error.js";
import {
  type AudioFadeCurve,
  type AudioMetadata,
  EMPTY_METADATA,
  MAX_GAIN_DB,
  MIN_GAIN_DB,
  NO_FADE,
} from "../model/plan.js";
import {
  type AudioTrack,
  type AudioTrackClip,
  type AudioTrackPlan,
  clipEnd,
  clipIndexAt,
  MAX_TRACK_NAME_LENGTH,
  orderProblem,
  trackPlanLength,
} from "../model/tracks.js";
import {
  type AudioCommandRejection,
  checkClip,
  fade,
  fitFades,
  Invalid,
  isIndex,
  isKey,
  isRecord,
  longerThan,
  MAX_METADATA_LENGTH,
  onlyFields,
  type SourceFrames,
  type Unchecked,
} from "./commands.js";

/**
 * The multitrack plan's commands and reducer (docs/adr/0006). Internal
 * until the session runs on them; nothing here is exported from the package
 * yet.
 *
 * Edits are of two kinds. **Clip edits never move another clip:** they fail
 * with `clips-overlap` rather than push a neighbour. **Time edits add or
 * remove time on the tracks they name,** and move everything after it on
 * those tracks.
 */

/** Adds clips to a track, each at its own `at`, in free space. */
export interface TrackInsertClipsCommand {
  readonly type: "audio.insertClips";
  readonly track: string;
  /** The clips, in any order, with keys the plan doesn't have. */
  readonly clips: readonly AudioTrackClip[];
}

/** Removes clips, on any tracks, leaving silence where they were. */
export interface TrackRemoveClipsCommand {
  readonly type: "audio.removeClips";
  readonly keys: readonly string[];
}

/**
 * Changes the range of its source a clip plays. The audio stays where it is
 * on the timeline: moving `start` moves the clip's `at` by the same amount.
 * Fades that no longer fit are shortened in proportion.
 */
export interface TrackTrimClipCommand {
  readonly type: "audio.trimClip";
  readonly key: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Splits a clip in two at a timeline frame strictly inside it. The first
 * part keeps the key and the fade in; the second takes `newKey` and the
 * fade out.
 */
export interface TrackSplitClipCommand {
  readonly type: "audio.splitClip";
  readonly key: string;
  readonly at: number;
  readonly newKey: string;
}

/** Moves clips by a signed number of frames, and to another track when one is named. */
export interface TrackMoveClipsCommand {
  readonly type: "audio.moveClips";
  readonly keys: readonly string[];
  /** Frames to move by: negative is earlier. */
  readonly by: number;
  /** The track every clip moves to. Without it, each stays on its own. */
  readonly track?: string;
}

/** Sets the gain of clips. */
export interface TrackSetGainCommand {
  readonly type: "audio.setGain";
  readonly keys: readonly string[];
  readonly gainDb: number;
}

/** Sets a clip's fade in or fade out. Together, the two must fit in the clip. */
export interface TrackSetFadeCommand {
  readonly type: "audio.setFade";
  readonly key: string;
  readonly edge: "in" | "out";
  readonly frames: number;
  readonly curve: AudioFadeCurve;
}

/**
 * Removes a range of time from the named tracks, trimming the clips at its
 * edges. With `ripple`, later clips on those tracks move earlier by the
 * range's length; without, silence stays.
 */
export interface TrackDeleteRangeCommand {
  readonly type: "audio.deleteRange";
  readonly start: number;
  readonly end: number;
  readonly tracks: readonly string[];
  readonly ripple: boolean;
  /**
   * By track key: the key of the part after the range, on a track where the
   * range lies inside one clip. A track that doesn't need its key ignores it.
   */
  readonly newKeys?: Readonly<Record<string, string>>;
}

/** Removes everything outside a range, on every track, and moves what's kept to the start. */
export interface TrackKeepRangeCommand {
  readonly type: "audio.keepRange";
  readonly start: number;
  readonly end: number;
}

/**
 * Opens `frames` of silence at a timeline frame on the named tracks. A clip
 * that lies across the frame is split there, and everything after moves
 * later.
 */
export interface TrackInsertTimeCommand {
  readonly type: "audio.insertTime";
  readonly at: number;
  readonly frames: number;
  readonly tracks: readonly string[];
  /** By track key: the key of the second part of a clip the frame splits. */
  readonly newKeys?: Readonly<Record<string, string>>;
}

/** Adds an empty track at an index. */
export interface TrackAddTrackCommand {
  readonly type: "audio.addTrack";
  readonly key: string;
  readonly index: number;
  readonly name?: string;
}

/** Removes tracks, with their clips. A plan keeps at least one track. */
export interface TrackRemoveTracksCommand {
  readonly type: "audio.removeTracks";
  readonly keys: readonly string[];
}

/** Moves a track to an index of the resulting plan. */
export interface TrackMoveTrackCommand {
  readonly type: "audio.moveTrack";
  readonly key: string;
  readonly to: number;
}

/** Sets the fields given of a track, at least one. */
export interface TrackSetTrackCommand {
  readonly type: "audio.setTrack";
  readonly key: string;
  readonly name?: string;
  readonly gainDb?: number;
  readonly muted?: boolean;
  readonly soloed?: boolean;
}

/** Sets the master gain. */
export interface TrackSetMasterGainCommand {
  readonly type: "audio.setMasterGain";
  readonly gainDb: number;
}

/** Sets the plan's channel count. */
export interface TrackSetChannelsCommand {
  readonly type: "audio.setChannels";
  readonly channels: number;
}

/** Sets one metadata field. */
export interface TrackSetMetadataCommand {
  readonly type: "audio.setMetadata";
  readonly field: keyof AudioMetadata;
  readonly value: string;
}

/** Puts removed clips back on their tracks. A clip's `at` says where. Undo's, for a removal. */
export interface TrackRestoreClipsCommand {
  readonly type: "audio.restoreClips";
  readonly entries: readonly { readonly track: string; readonly clip: AudioTrackClip }[];
}

/** Sets clips, matched by key, to states with every field given. Undo's, for a trim, a gain or a fade. */
export interface TrackUpdateClipsCommand {
  readonly type: "audio.updateClips";
  readonly clips: readonly AudioTrackClip[];
}

/** Puts clips on tracks and positions. Undo's, for a move, and its own inverse. */
export interface TrackPlaceClipsCommand {
  readonly type: "audio.placeClips";
  readonly entries: readonly {
    readonly key: string;
    readonly track: string;
    readonly at: number;
  }[];
}

/** One track's part of {@link TrackReplaceClipsCommand}. */
export interface TrackClipsEdit {
  readonly track: string;
  /** The first clip of the run to replace. */
  readonly index: number;
  /** How many clips the run has. */
  readonly count: number;
  /** What takes the run's place. */
  readonly clips: readonly AudioTrackClip[];
  /** Frames every clip after the run moves by: negative is earlier. */
  readonly shift: number;
}

/**
 * On each named track, replaces a run of neighbouring clips, then moves
 * every clip after the run by `shift` frames. Undo's, for a split and for
 * the time edits, and its own inverse: a ripple that moved a thousand clips
 * is undone by one number.
 */
export interface TrackReplaceClipsCommand {
  readonly type: "audio.replaceClips";
  readonly edits: readonly TrackClipsEdit[];
}

/** Puts removed tracks back at their indexes, with their clips and settings. Undo's. */
export interface TrackRestoreTracksCommand {
  readonly type: "audio.restoreTracks";
  /** Each track, and the index it takes in the resulting plan, in increasing order. */
  readonly entries: readonly { readonly index: number; readonly track: AudioTrack }[];
}

/**
 * The edits a user makes to a multitrack plan: `hm-audio-command` version 2.
 *
 * @internal
 */
export type AudioTrackUserCommand =
  | TrackInsertClipsCommand
  | TrackRemoveClipsCommand
  | TrackTrimClipCommand
  | TrackSplitClipCommand
  | TrackMoveClipsCommand
  | TrackSetGainCommand
  | TrackSetFadeCommand
  | TrackDeleteRangeCommand
  | TrackKeepRangeCommand
  | TrackInsertTimeCommand
  | TrackAddTrackCommand
  | TrackRemoveTracksCommand
  | TrackMoveTrackCommand
  | TrackSetTrackCommand
  | TrackSetMasterGainCommand
  | TrackSetChannelsCommand
  | TrackSetMetadataCommand;

/**
 * Every command of the multitrack plan: the user's, and the inverses that
 * only undo runs, which aren't part of the portable format.
 *
 * @internal
 */
export type AudioTrackCommand =
  | AudioTrackUserCommand
  | TrackRestoreClipsCommand
  | TrackUpdateClipsCommand
  | TrackPlaceClipsCommand
  | TrackReplaceClipsCommand
  | TrackRestoreTracksCommand;

/**
 * Why the multitrack reducer refused a command: the single-track tokens,
 * and
 *
 * - `clips-overlap`: a clip would start before the one before it has ended;
 * - `clips-out-of-order`: a list of a track's clips isn't in time order;
 * - `no-tracks`: the command needs at least one track, and names none;
 * - `unknown-track`: it names a track the plan doesn't have;
 * - `last-track`: it would leave the plan without a track;
 * - `name-too-long`: a track's name is over {@link MAX_TRACK_NAME_LENGTH}
 *   code points.
 *
 * @internal
 */
export type AudioTrackCommandRejection =
  | AudioCommandRejection
  | "clips-overlap"
  | "clips-out-of-order"
  | "no-tracks"
  | "unknown-track"
  | "last-track"
  | "name-too-long";

/** @internal */
export function refuse(reason: AudioTrackCommandRejection, message: string): never {
  throw new Invalid(reason, message);
}

const COMMAND_FIELDS: Readonly<Record<AudioTrackCommand["type"], readonly string[]>> = {
  "audio.insertClips": ["track", "clips"],
  "audio.removeClips": ["keys"],
  "audio.trimClip": ["key", "start", "end"],
  "audio.splitClip": ["key", "at", "newKey"],
  "audio.moveClips": ["keys", "by", "track"],
  "audio.setGain": ["keys", "gainDb"],
  "audio.setFade": ["key", "edge", "frames", "curve"],
  "audio.deleteRange": ["start", "end", "tracks", "ripple", "newKeys"],
  "audio.keepRange": ["start", "end"],
  "audio.insertTime": ["at", "frames", "tracks", "newKeys"],
  "audio.addTrack": ["key", "index", "name"],
  "audio.removeTracks": ["keys"],
  "audio.moveTrack": ["key", "to"],
  "audio.setTrack": ["key", "name", "gainDb", "muted", "soloed"],
  "audio.setMasterGain": ["gainDb"],
  "audio.setChannels": ["channels"],
  "audio.setMetadata": ["field", "value"],
  "audio.restoreClips": ["entries"],
  "audio.updateClips": ["clips"],
  "audio.placeClips": ["entries"],
  "audio.replaceClips": ["edits"],
  "audio.restoreTracks": ["entries"],
};
const TRACK_FIELDS = ["key", "name", "gainDb", "muted", "soloed", "clips"];

const isFrames = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

/** A gain in range, or a failure. */
function checkGain(value: unknown): number {
  if (typeof value !== "number" || !(value >= MIN_GAIN_DB && value <= MAX_GAIN_DB)) {
    refuse("gain-out-of-range", `gain must be from ${MIN_GAIN_DB} to ${MAX_GAIN_DB} dB`);
  }
  return value;
}

/** A track's name, or a failure. */
function checkName(value: unknown): string {
  if (typeof value !== "string") refuse("malformed-command", "a track's name must be text");
  if (longerThan(value, MAX_TRACK_NAME_LENGTH)) {
    refuse("name-too-long", `a track's name can have at most ${MAX_TRACK_NAME_LENGTH} code points`);
  }
  return value;
}

function checkFlag(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") refuse("malformed-command", `${name} must be true or false`);
  return value;
}

/**
 * A clean copy of a positioned clip, with only its own fields, or a failure
 * if it isn't valid within its source or its position isn't whole frames.
 *
 * @internal
 */
export function checkTrackClip(value: unknown, sourceFrames: SourceFrames): AudioTrackClip {
  if (!isRecord<AudioTrackClip>(value)) refuse("malformed-command", "a clip is an object");
  // The clip without its position is a single-track clip, checked as one.
  const clip = checkClip({ ...value, at: undefined }, sourceFrames);
  const { at } = value;
  if (!isFrames(at) || !Number.isSafeInteger(at + (clip.end - clip.start))) {
    refuse("invalid-frames", `clip ${clip.key}'s position isn't a whole number of frames`);
  }
  return {
    key: clip.key,
    at,
    source: clip.source,
    start: clip.start,
    end: clip.end,
    gainDb: clip.gainDb,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
  };
}

function checkTrackClips(values: unknown, sourceFrames: SourceFrames): AudioTrackClip[] {
  if (!Array.isArray(values)) refuse("malformed-command", "clips must be a list");
  return values.map((value) => checkTrackClip(value, sourceFrames));
}

/** Fails unless a track's clips are in time order and don't overlap. */
function checkOrder(clips: readonly AudioTrackClip[]): void {
  const problem = orderProblem(clips);
  if (problem === "clips-overlap") refuse(problem, "two clips on a track would overlap");
  if (problem) refuse(problem, "a track's clips must be in time order");
}

/** Clips in time order. Clips that start together stay as they were, and fail as overlapping. */
function sorted(clips: readonly AudioTrackClip[]): AudioTrackClip[] {
  return [...clips].sort((a, b) => a.at - b.at);
}

/**
 * A clean copy of a whole track, or a failure. Its keys aren't compared
 * with any other track's here.
 *
 * @internal
 */
export function checkTrack(value: unknown, sourceFrames: SourceFrames): AudioTrack {
  if (!isRecord<AudioTrack>(value) || !isKey(value.key)) {
    refuse("malformed-command", "a track needs a key");
  }
  onlyFields(value, TRACK_FIELDS, "a track");
  const clips = checkTrackClips(value.clips, sourceFrames);
  checkOrder(clips);
  return {
    key: value.key,
    name: checkName(value.name),
    gainDb: checkGain(value.gainDb),
    muted: checkFlag(value.muted, "muted"),
    soloed: checkFlag(value.soloed, "soloed"),
    clips,
  };
}

/** Every key in the plan: its tracks' and its clips'. */
function keysOf(plan: AudioTrackPlan): Set<string> {
  const keys = new Set<string>();
  for (const track of plan.tracks) {
    keys.add(track.key);
    for (const clip of track.clips) keys.add(clip.key);
  }
  return keys;
}

/**
 * Fails unless every key in the plan is there once.
 *
 * @internal
 */
export function checkUniqueKeys(plan: AudioTrackPlan): void {
  const seen = new Set<string>();
  const once = (key: string) => {
    if (seen.has(key)) refuse("duplicate-key", `the key ${key} appears twice`);
    seen.add(key);
  };
  for (const track of plan.tracks) {
    once(track.key);
    for (const clip of track.clips) once(clip.key);
  }
}

/** Fails unless every key is new: absent from `taken`, which it then joins. */
function claim(keys: readonly unknown[], taken: Set<string>): void {
  const before = new Set(taken);
  for (const key of keys) {
    if (!isKey(key)) refuse("malformed-command", "a key must be a non-empty string");
    if (before.has(key)) refuse("key-taken", `the key ${key} is taken`);
    if (taken.has(key)) refuse("duplicate-key", `the key ${key} appears twice`);
    taken.add(key);
  }
}

/** A list of keys, each once, or a failure with `empty` when there are none. */
function keyList(value: unknown, empty: "no-clips" | "no-tracks"): string[] {
  if (!Array.isArray(value)) refuse("malformed-command", "keys must be a list");
  if (value.length === 0) refuse(empty, "it needs at least one");
  const seen = new Set<string>();
  for (const key of value) {
    if (!isKey(key)) refuse("malformed-command", "a key must be a non-empty string");
    if (seen.has(key)) refuse("duplicate-key", `the key ${key} appears twice`);
    seen.add(key);
  }
  return value as string[];
}

/** The index of a track, by key. */
function trackIndex(plan: AudioTrackPlan, key: unknown): number {
  if (!isKey(key)) refuse("malformed-command", "a track is named by its key");
  const index = plan.tracks.findIndex((track) => track.key === key);
  if (index < 0) refuse("unknown-track", `the plan has no track ${key}`);
  return index;
}

/** The indexes of tracks, by key, in the order given. */
function trackIndexes(plan: AudioTrackPlan, keys: unknown): number[] {
  return keyList(keys, "no-tracks").map((key) => trackIndex(plan, key));
}

interface Located {
  /** The index of the clip's track. */
  readonly track: number;
  readonly clip: AudioTrackClip;
}

/** Where the named clips are, in plan order. */
function locateClips(plan: AudioTrackPlan, keys: unknown): Located[] {
  const wanted = new Set(keyList(keys, "no-clips"));
  const found: Located[] = [];
  plan.tracks.forEach((track, index) => {
    for (const clip of track.clips) {
      if (wanted.has(clip.key)) found.push({ track: index, clip });
    }
  });
  if (found.length !== wanted.size) refuse("unknown-clip", "the plan doesn't have every clip");
  return found;
}

function locateClip(plan: AudioTrackPlan, key: unknown): Located {
  return locateClips(plan, [key])[0] as Located;
}

/** The plan with some tracks' clips replaced, by track index. */
function withClips(
  plan: AudioTrackPlan,
  changes: ReadonlyMap<number, readonly AudioTrackClip[]>,
): AudioTrackPlan {
  if (changes.size === 0) return plan;
  return {
    ...plan,
    tracks: plan.tracks.map((track, index) => {
      const clips = changes.get(index);
      return clips ? { ...track, clips } : track;
    }),
  };
}

/** The plan with clips replaced by new states of themselves, each staying on its track. */
function withUpdated(plan: AudioTrackPlan, clips: readonly AudioTrackClip[]): AudioTrackPlan {
  const byKey = new Map(clips.map((clip) => [clip.key, clip]));
  const changes = new Map<number, AudioTrackClip[]>();
  plan.tracks.forEach((track, index) => {
    if (track.clips.some((clip) => byKey.has(clip.key))) {
      const next = track.clips.map((clip) => byKey.get(clip.key) ?? clip);
      checkOrder(next);
      changes.set(index, next);
    }
  });
  return withClips(plan, changes);
}

/**
 * The part of a clip from `from` to `to`, in frames from its start, placed
 * at `at`. A part keeps the fades of the edges it shares with the clip, and
 * has none at a cut.
 */
function cut(
  clip: AudioTrackClip,
  from: number,
  to: number,
  key: string,
  at: number,
): AudioTrackClip {
  return fitFades({
    ...clip,
    key,
    at,
    start: clip.start + from,
    end: clip.start + to,
    fadeIn: from === 0 ? clip.fadeIn : NO_FADE,
    fadeOut: to === clip.end - clip.start ? clip.fadeOut : NO_FADE,
  });
}

/** Clips moved by a signed number of frames, or a failure if one would leave the timeline. */
function shifted(clips: readonly AudioTrackClip[], by: number): AudioTrackClip[] {
  if (by === 0) return [...clips];
  return clips.map((clip) => {
    const at = clip.at + by;
    if (at < 0) refuse("frame-outside-plan", "a clip can't start before the timeline does");
    if (!Number.isSafeInteger(at + (clip.end - clip.start))) {
      refuse("invalid-frames", "a clip's position isn't a whole number of frames");
    }
    return { ...clip, at };
  });
}

/** A range of the timeline inside the plan, at least one frame long. */
function checkRange(plan: AudioTrackPlan, start: unknown, end: unknown): [number, number] {
  const length = trackPlanLength(plan);
  if (!isIndex(start, length) || !isIndex(end, length)) {
    refuse("frame-outside-plan", "the range must be inside the plan");
  }
  if (end <= start) refuse("empty-range", "the range must be at least one frame long");
  return [start, end];
}

/**
 * The optional keys of a time edit, by the key of the track each is for.
 * Read as own fields, so a track keyed `__proto__` is a track like any other.
 */
function newKeysFor(value: unknown, tracks: readonly string[]): ReadonlyMap<string, string> {
  const keys = new Map<string, string>();
  if (value === undefined) return keys;
  if (!isRecord<Record<string, unknown>>(value) || Array.isArray(value)) {
    refuse("malformed-command", "newKeys is an object of keys, by track");
  }
  for (const [track, key] of Object.entries(value)) {
    if (!isKey(track) || !isKey(key)) {
      refuse("malformed-command", "newKeys is an object of keys, by track");
    }
    if (!tracks.includes(track)) refuse("unknown-track", `the command doesn't edit track ${track}`);
    keys.set(track, key);
  }
  return keys;
}

/** Puts clips on tracks and positions, keeping each touched track in time order. */
function place(
  plan: AudioTrackPlan,
  placements: ReadonlyMap<string, { readonly track: number; readonly at: number }>,
): AudioTrackPlan {
  const arriving = new Map<number, AudioTrackClip[]>();
  const changes = new Map<number, AudioTrackClip[]>();
  plan.tracks.forEach((track, index) => {
    const staying: AudioTrackClip[] = [];
    for (const clip of track.clips) {
      const to = placements.get(clip.key);
      if (!to) {
        staying.push(clip);
        continue;
      }
      const moved = shifted([clip], to.at - clip.at);
      arriving.set(to.track, [...(arriving.get(to.track) ?? []), ...moved]);
    }
    if (staying.length !== track.clips.length) changes.set(index, staying);
  });
  for (const [index, clips] of arriving) {
    const base = changes.get(index) ?? (plan.tracks[index] as AudioTrack).clips;
    changes.set(index, sorted([...base, ...clips]));
  }
  for (const clips of changes.values()) checkOrder(clips);
  return withClips(plan, changes);
}

type Applied = { state: AudioTrackPlan; inverse: AudioTrackCommand };

/** A time edit's result: the tracks' new clips, and the edits that undo them. */
interface TimeEdit {
  readonly changes: Map<number, AudioTrackClip[]>;
  readonly undo: TrackClipsEdit[];
}

function timeEdit(plan: AudioTrackPlan, edit: TimeEdit): Applied {
  return {
    state: withClips(plan, edit.changes),
    inverse: { type: "audio.replaceClips", edits: edit.undo },
  };
}

function apply(
  plan: AudioTrackPlan,
  command: AudioTrackCommand,
  sourceFrames: SourceFrames,
): Applied {
  if (!isRecord<AudioTrackCommand>(command)) refuse("malformed-command", "a command is an object");
  const fields = Object.hasOwn(COMMAND_FIELDS, command.type as string)
    ? COMMAND_FIELDS[command.type as AudioTrackCommand["type"]]
    : undefined;
  if (!fields) refuse("unknown-command", "unknown command");
  onlyFields(command, ["type", ...fields], command.type as string);

  // Each command checks what its schema states, such as a gain's range,
  // before what depends on the plan, so a command a schema refuses is
  // refused here for the schema's reason.
  switch (command.type) {
    case "audio.insertClips": {
      const index = trackIndex(plan, command.track);
      const clips = checkTrackClips(command.clips, sourceFrames);
      if (clips.length === 0) refuse("no-clips", "it needs at least one clip");
      const keys = clips.map((clip) => clip.key);
      claim(keys, keysOf(plan));
      const next = sorted([...(plan.tracks[index] as AudioTrack).clips, ...clips]);
      checkOrder(next);
      return {
        state: withClips(plan, new Map([[index, next]])),
        inverse: { type: "audio.removeClips", keys },
      };
    }

    case "audio.removeClips": {
      const found = locateClips(plan, command.keys);
      const removed = new Set(found.map(({ clip }) => clip.key));
      const changes = new Map<number, AudioTrackClip[]>();
      for (const { track } of found) {
        changes.set(
          track,
          (plan.tracks[track] as AudioTrack).clips.filter((clip) => !removed.has(clip.key)),
        );
      }
      return {
        state: withClips(plan, changes),
        inverse: {
          type: "audio.restoreClips",
          entries: found.map(({ track, clip }) => ({
            track: (plan.tracks[track] as AudioTrack).key,
            clip,
          })),
        },
      };
    }

    case "audio.restoreClips": {
      if (!Array.isArray(command.entries)) refuse("malformed-command", "entries must be a list");
      if (command.entries.length === 0) refuse("no-clips", "it needs at least one clip");
      const arriving = new Map<number, AudioTrackClip[]>();
      const keys: string[] = [];
      for (const entry of command.entries as unknown[]) {
        if (!isRecord<{ track: string; clip: AudioTrackClip }>(entry)) {
          refuse("malformed-command", "an entry needs a track and a clip");
        }
        onlyFields(entry, ["track", "clip"], "an entry");
        const index = trackIndex(plan, entry.track);
        const clip = checkTrackClip(entry.clip, sourceFrames);
        keys.push(clip.key);
        arriving.set(index, [...(arriving.get(index) ?? []), clip]);
      }
      claim(keys, keysOf(plan));
      const changes = new Map<number, AudioTrackClip[]>();
      for (const [index, clips] of arriving) {
        const next = sorted([...(plan.tracks[index] as AudioTrack).clips, ...clips]);
        checkOrder(next);
        changes.set(index, next);
      }
      return {
        state: withClips(plan, changes),
        inverse: { type: "audio.removeClips", keys },
      };
    }

    case "audio.updateClips": {
      const clips = checkTrackClips(command.clips, sourceFrames);
      const before = locateClips(
        plan,
        clips.map((clip) => clip.key),
      ).map(({ clip }) => clip);
      return {
        state: withUpdated(plan, clips),
        inverse: { type: "audio.updateClips", clips: before },
      };
    }

    case "audio.placeClips": {
      if (!Array.isArray(command.entries)) refuse("malformed-command", "entries must be a list");
      const placements = new Map<string, { track: number; at: number }>();
      const keys: unknown[] = [];
      for (const entry of command.entries as unknown[]) {
        if (!isRecord<{ key: string; track: string; at: number }>(entry)) {
          refuse("malformed-command", "an entry needs a key, a track and a position");
        }
        onlyFields(entry, ["key", "track", "at"], "an entry");
        if (!isFrames(entry.at)) refuse("invalid-frames", "a position is a whole number of frames");
        keys.push(entry.key);
        if (isKey(entry.key)) {
          placements.set(entry.key, { track: trackIndex(plan, entry.track), at: entry.at });
        }
      }
      const found = locateClips(plan, keys);
      return {
        state: place(plan, placements),
        inverse: {
          type: "audio.placeClips",
          entries: found.map(({ track, clip }) => ({
            key: clip.key,
            track: (plan.tracks[track] as AudioTrack).key,
            at: clip.at,
          })),
        },
      };
    }

    case "audio.moveClips": {
      const { by } = command;
      if (!Number.isSafeInteger(by)) refuse("malformed-command", "by is a whole number of frames");
      const found = locateClips(plan, command.keys);
      const to = command.track === undefined ? undefined : trackIndex(plan, command.track);
      const placements = new Map(
        found.map(({ track, clip }) => [
          clip.key,
          { track: to ?? track, at: clip.at + (by as number) },
        ]),
      );
      return {
        state: place(plan, placements),
        inverse: {
          type: "audio.placeClips",
          entries: found.map(({ track, clip }) => ({
            key: clip.key,
            track: (plan.tracks[track] as AudioTrack).key,
            at: clip.at,
          })),
        },
      };
    }

    case "audio.trimClip": {
      const { track, clip } = locateClip(plan, command.key);
      const { start, end } = command;
      // The audio stays where it is: the position moves with the start.
      const at = isFrames(start) ? clip.at + (start - clip.start) : clip.at;
      if (at < 0) refuse("frame-outside-plan", "a clip can't start before the timeline does");
      const trimmed = checkTrackClip(
        fitFades({ ...clip, at, start: start as number, end: end as number }),
        sourceFrames,
      );
      const clips = sorted(
        (plan.tracks[track] as AudioTrack).clips.map((entry) =>
          entry.key === clip.key ? trimmed : entry,
        ),
      );
      checkOrder(clips);
      return {
        state: withClips(plan, new Map([[track, clips]])),
        inverse: { type: "audio.updateClips", clips: [clip] },
      };
    }

    case "audio.splitClip": {
      const { track, clip } = locateClip(plan, command.key);
      const { at } = command;
      if (!isIndex(at, trackPlanLength(plan))) {
        refuse("frame-outside-plan", "the frame is outside the plan");
      }
      if (at <= clip.at || at >= clipEnd(clip)) {
        refuse("not-inside-clip", "the frame must be strictly inside the clip");
      }
      claim([command.newKey], keysOf(plan));
      const length = clip.end - clip.start;
      const parts = [
        cut(clip, 0, at - clip.at, clip.key, clip.at),
        cut(clip, at - clip.at, length, command.newKey, at),
      ];
      const clips = (plan.tracks[track] as AudioTrack).clips;
      const index = clips.indexOf(clip);
      return {
        state: withClips(
          plan,
          new Map([[track, [...clips.slice(0, index), ...parts, ...clips.slice(index + 1)]]]),
        ),
        inverse: {
          type: "audio.replaceClips",
          edits: [
            {
              track: (plan.tracks[track] as AudioTrack).key,
              index,
              count: 2,
              clips: [clip],
              shift: 0,
            },
          ],
        },
      };
    }

    case "audio.setGain": {
      const gainDb = checkGain(command.gainDb);
      const before = locateClips(plan, command.keys).map(({ clip }) => clip);
      return {
        state: withUpdated(
          plan,
          before.map((clip) => ({ ...clip, gainDb })),
        ),
        inverse: { type: "audio.updateClips", clips: before },
      };
    }

    case "audio.setFade": {
      const { clip } = locateClip(plan, command.key);
      const { edge, frames } = command;
      if (edge !== "in" && edge !== "out") refuse("invalid-edge", "the edge must be in or out");
      const next = { frames, curve: fade({ frames, curve: command.curve }, "the fade").curve };
      const updated = checkTrackClip(
        edge === "in" ? { ...clip, fadeIn: next } : { ...clip, fadeOut: next },
        sourceFrames,
      );
      return {
        state: withUpdated(plan, [updated]),
        inverse: { type: "audio.updateClips", clips: [clip] },
      };
    }

    case "audio.deleteRange": {
      const [start, end] = checkRange(plan, command.start, command.end);
      const indexes = trackIndexes(plan, command.tracks);
      const ripple = checkFlag(command.ripple, "ripple");
      const newKeys = newKeysFor(command.newKeys, command.tracks as string[]);
      const taken = keysOf(plan);
      const edit: TimeEdit = { changes: new Map(), undo: [] };
      indexes.forEach((index) => {
        const track = plan.tracks[index] as AudioTrack;
        const { clips } = track;
        // The run of clips the range touches: from the first that ends
        // after its start, up to the first that starts at or after its end.
        const first = clipIndexAt(clips, start);
        let after = first;
        while (after < clips.length && (clips[after] as AudioTrackClip).at < end) after += 1;
        const kept: AudioTrackClip[] = [];
        if (after > first) {
          const head = clips[first] as AudioTrackClip;
          const tail = clips[after - 1] as AudioTrackClip;
          if (head.at < start) kept.push(cut(head, 0, start - head.at, head.key, head.at));
          if (clipEnd(tail) > end) {
            let key = tail.key;
            if (kept.length > 0 && tail === head) {
              const newKey = newKeys.get(track.key);
              if (newKey === undefined) {
                refuse("new-key-required", "deleting inside a clip needs a new key for its track");
              }
              claim([newKey], taken);
              key = newKey;
            }
            kept.push(cut(tail, end - tail.at, tail.end - tail.start, key, ripple ? start : end));
          }
        }
        const rest = clips.slice(after);
        const shift = ripple && rest.length > 0 ? start - end : 0;
        if (after === first && shift === 0) return;
        edit.changes.set(index, [...clips.slice(0, first), ...kept, ...shifted(rest, shift)]);
        edit.undo.push({
          track: track.key,
          index: first,
          count: kept.length,
          clips: clips.slice(first, after),
          shift: shift === 0 ? 0 : -shift,
        });
      });
      return timeEdit(plan, edit);
    }

    case "audio.keepRange": {
      const [start, end] = checkRange(plan, command.start, command.end);
      const edit: TimeEdit = { changes: new Map(), undo: [] };
      plan.tracks.forEach((track, index) => {
        const { clips } = track;
        if (clips.length === 0) return;
        const kept: AudioTrackClip[] = [];
        for (const clip of clips) {
          const from = Math.max(clip.at, start);
          const to = Math.min(clipEnd(clip), end);
          if (to > from) kept.push(cut(clip, from - clip.at, to - clip.at, clip.key, from - start));
        }
        edit.changes.set(index, kept);
        edit.undo.push({ track: track.key, index: 0, count: kept.length, clips, shift: 0 });
      });
      return timeEdit(plan, edit);
    }

    case "audio.insertTime": {
      const { at, frames } = command;
      if (!isFrames(frames) || frames < 1) {
        refuse("invalid-frames", "the time to insert is a whole number of frames, at least one");
      }
      if (!isIndex(at, trackPlanLength(plan))) {
        refuse("frame-outside-plan", "the frame is outside the plan");
      }
      const indexes = trackIndexes(plan, command.tracks);
      const newKeys = newKeysFor(command.newKeys, command.tracks as string[]);
      const taken = keysOf(plan);
      const edit: TimeEdit = { changes: new Map(), undo: [] };
      indexes.forEach((index) => {
        const track = plan.tracks[index] as AudioTrack;
        const { clips } = track;
        const first = clipIndexAt(clips, at);
        const across = clips[first];
        if (across && across.at < at) {
          const newKey = newKeys.get(track.key);
          if (newKey === undefined) {
            refuse(
              "new-key-required",
              "inserting time inside a clip needs a new key for its track",
            );
          }
          claim([newKey], taken);
          const parts = [
            cut(across, 0, at - across.at, across.key, across.at),
            ...shifted(
              [cut(across, at - across.at, across.end - across.start, newKey, at)],
              frames,
            ),
          ];
          edit.changes.set(index, [
            ...clips.slice(0, first),
            ...parts,
            ...shifted(clips.slice(first + 1), frames),
          ]);
          edit.undo.push({
            track: track.key,
            index: first,
            count: 2,
            clips: [across],
            shift: -frames,
          });
          return;
        }
        const rest = clips.slice(first);
        if (rest.length === 0) return;
        edit.changes.set(index, [...clips.slice(0, first), ...shifted(rest, frames)]);
        edit.undo.push({ track: track.key, index: first, count: 0, clips: [], shift: -frames });
      });
      return timeEdit(plan, edit);
    }

    case "audio.replaceClips": {
      if (!Array.isArray(command.edits)) refuse("malformed-command", "edits must be a list");
      const edit: TimeEdit = { changes: new Map(), undo: [] };
      for (const value of command.edits as unknown[]) {
        if (!isRecord<TrackClipsEdit>(value)) refuse("malformed-command", "an edit is an object");
        onlyFields(value, ["track", "index", "count", "clips", "shift"], "an edit");
        const index = trackIndex(plan, value.track);
        if (edit.changes.has(index)) refuse("duplicate-key", "a track is edited twice");
        const track = plan.tracks[index] as AudioTrack;
        const { index: from, count, shift } = value;
        if (!isIndex(from, track.clips.length) || !isIndex(count, track.clips.length - from)) {
          refuse("invalid-index", "the run of clips is outside the track");
        }
        if (!Number.isSafeInteger(shift)) {
          refuse("malformed-command", "shift is a whole number of frames");
        }
        const clips = checkTrackClips(value.clips, sourceFrames);
        const next = [
          ...track.clips.slice(0, from),
          ...clips,
          ...shifted(track.clips.slice(from + count), shift as number),
        ];
        checkOrder(next);
        edit.changes.set(index, next);
        edit.undo.push({
          track: track.key,
          index: from,
          count: clips.length,
          clips: track.clips.slice(from, from + count),
          shift: shift === 0 ? 0 : -(shift as number),
        });
      }
      const applied = timeEdit(plan, edit);
      checkUniqueKeys(applied.state);
      return applied;
    }

    case "audio.addTrack": {
      const { key, index } = command;
      const name = command.name === undefined ? "" : checkName(command.name);
      claim([key], keysOf(plan));
      if (!isIndex(index, plan.tracks.length)) refuse("invalid-index", "the track can't go there");
      const track: AudioTrack = {
        key: key as string,
        name,
        gainDb: 0,
        muted: false,
        soloed: false,
        clips: [],
      };
      return {
        state: {
          ...plan,
          tracks: [...plan.tracks.slice(0, index), track, ...plan.tracks.slice(index)],
        },
        inverse: { type: "audio.removeTracks", keys: [track.key] },
      };
    }

    case "audio.removeTracks": {
      const removed = new Set(trackIndexes(plan, command.keys));
      if (removed.size === plan.tracks.length) {
        refuse("last-track", "a plan keeps at least one track");
      }
      return {
        state: { ...plan, tracks: plan.tracks.filter((_, index) => !removed.has(index)) },
        inverse: {
          type: "audio.restoreTracks",
          entries: [...removed]
            .sort((a, b) => a - b)
            .map((index) => ({ index, track: plan.tracks[index] as AudioTrack })),
        },
      };
    }

    case "audio.restoreTracks": {
      if (!Array.isArray(command.entries)) refuse("malformed-command", "entries must be a list");
      if (command.entries.length === 0) refuse("no-tracks", "it needs at least one track");
      const tracks = [...plan.tracks];
      const keys: string[] = [];
      let previous = -1;
      for (const entry of command.entries as unknown[]) {
        if (!isRecord<{ index: number; track: AudioTrack }>(entry)) {
          refuse("malformed-command", "an entry needs an index and a track");
        }
        onlyFields(entry, ["index", "track"], "an entry");
        const track = checkTrack(entry.track, sourceFrames);
        const { index } = entry;
        if (!isIndex(index, tracks.length) || index <= previous) {
          refuse("invalid-index", `track ${track.key} can't be restored at that index`);
        }
        tracks.splice(index, 0, track);
        keys.push(track.key);
        previous = index;
      }
      const state = { ...plan, tracks };
      checkUniqueKeys(state);
      return { state, inverse: { type: "audio.removeTracks", keys } };
    }

    case "audio.moveTrack": {
      const from = trackIndex(plan, command.key);
      const { to } = command;
      if (!isIndex(to, plan.tracks.length - 1)) refuse("invalid-index", "the track can't go there");
      const tracks = plan.tracks.filter((_, index) => index !== from);
      tracks.splice(to, 0, plan.tracks[from] as AudioTrack);
      return {
        state: { ...plan, tracks },
        inverse: { type: "audio.moveTrack", key: command.key as string, to: from },
      };
    }

    case "audio.setTrack": {
      const { name, gainDb, muted, soloed } = command as Unchecked<TrackSetTrackCommand>;
      const next = {
        ...(name === undefined ? {} : { name: checkName(name) }),
        ...(gainDb === undefined ? {} : { gainDb: checkGain(gainDb) }),
        ...(muted === undefined ? {} : { muted: checkFlag(muted, "muted") }),
        ...(soloed === undefined ? {} : { soloed: checkFlag(soloed, "soloed") }),
      };
      const changed = Object.keys(next) as (keyof typeof next)[];
      if (changed.length === 0) refuse("empty-change", "it sets nothing");
      const index = trackIndex(plan, command.key);
      const track = plan.tracks[index] as AudioTrack;
      const before = Object.fromEntries(changed.map((field) => [field, track[field]]));
      return {
        state: {
          ...plan,
          tracks: plan.tracks.map((entry, at) => (at === index ? { ...track, ...next } : entry)),
        },
        inverse: { type: "audio.setTrack", key: track.key, ...before },
      };
    }

    case "audio.setMasterGain":
      return {
        state: { ...plan, gainDb: checkGain(command.gainDb) },
        inverse: { type: "audio.setMasterGain", gainDb: plan.gainDb },
      };

    case "audio.setChannels": {
      const { channels } = command;
      if (!isFrames(channels) || channels < 1) {
        refuse("malformed-command", "channels is a whole number, at least one");
      }
      return {
        state: { ...plan, channels },
        inverse: { type: "audio.setChannels", channels: plan.channels },
      };
    }

    case "audio.setMetadata": {
      const { field, value } = command;
      if (typeof field !== "string" || !Object.hasOwn(EMPTY_METADATA, field)) {
        refuse("unknown-metadata-field", "there's no such metadata field");
      }
      if (typeof value !== "string") refuse("malformed-command", "a metadata value must be text");
      if (longerThan(value, MAX_METADATA_LENGTH)) {
        refuse(
          "metadata-too-long",
          `a metadata value can have at most ${MAX_METADATA_LENGTH} code points`,
        );
      }
      return {
        state: { ...plan, metadata: { ...plan.metadata, [field]: value } },
        inverse: { type: "audio.setMetadata", field, value: plan.metadata[field] },
      };
    }

    default:
      return refuse("unknown-command", "unknown command");
  }
}

/**
 * Creates the multitrack plan's reducer (docs/adr/0006): it applies one
 * command without changing the plan, and returns the new plan with the
 * command's exact inverse. An invalid command throws `AudioError` with
 * `INVALID_COMMAND` and a {@link AudioTrackCommandRejection} as
 * `details.reason`, and changes nothing.
 *
 * @internal
 */
export function createTrackPlanReducer(
  sourceFrames: SourceFrames,
): Reducer<AudioTrackPlan, AudioTrackCommand> {
  return (plan, command) => {
    try {
      return apply(plan, command, sourceFrames);
    } catch (error) {
      if (!(error instanceof Invalid)) throw error;
      const type =
        isRecord<AudioTrackCommand>(command) && typeof command.type === "string"
          ? command.type
          : "";
      const known = type.startsWith("audio.") && type.length <= 64;
      throw new AudioError(
        "INVALID_COMMAND",
        `Invalid ${known ? type : "command"}: ${error.message}.`,
        { details: known ? { command: type, reason: error.reason } : { reason: error.reason } },
      );
    }
  };
}
