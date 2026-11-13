import { locate as locateIn, type Reducer } from "@hussmartinez/sdk-core";
import { AudioError } from "../errors/audio-error.js";
import {
  type AudioClip,
  type AudioClipProblem,
  type AudioFade,
  type AudioFadeCurve,
  type AudioMetadata,
  type AudioPlan,
  clipBoundaries,
  clipLength,
  clipProblem,
  EMPTY_METADATA,
  MAX_GAIN_DB,
  MIN_GAIN_DB,
  NO_FADE,
  planLength,
} from "../model/plan.js";

/**
 * Inserts clips at a timeline frame. When the frame falls inside a clip,
 * that clip is split there: its first part keeps its key, and its second
 * part takes `splitKey`.
 *
 * @public
 */
export interface AudioInsertClipsCommand {
  readonly type: "audio.insertClips";
  /** The timeline frame to insert at, from 0 to the plan's length. */
  readonly at: number;
  /** The clips, in order, with keys the plan doesn't have. */
  readonly clips: readonly AudioClip[];
  /** The key of the second part of a clip that `at` splits. Required only then. */
  readonly splitKey?: string;
}

/**
 * Removes clips. Their sources stay, so undo can bring them back.
 *
 * @public
 */
export interface AudioRemoveClipsCommand {
  readonly type: "audio.removeClips";
  readonly keys: readonly string[];
}

/**
 * Puts removed clips back at their indexes, with every field as it was.
 * It's what undoing a removal runs.
 *
 * @public
 */
export interface AudioRestoreClipsCommand {
  readonly type: "audio.restoreClips";
  /** Each clip, and the index it takes in the resulting plan, in increasing order. */
  readonly entries: readonly { readonly index: number; readonly clip: AudioClip }[];
}

/**
 * Replaces `count` clips from `index` with `clips`. It's what undoing an
 * insert, a split or a range deletion runs: those change a run of
 * neighbouring clips.
 *
 * @public
 */
export interface AudioReplaceClipsCommand {
  readonly type: "audio.replaceClips";
  readonly index: number;
  readonly count: number;
  readonly clips: readonly AudioClip[];
}

/**
 * Sets clips to new states, matched by key, with every field given. It's
 * what undoing a trim, a gain or a fade runs.
 *
 * @public
 */
export interface AudioUpdateClipsCommand {
  readonly type: "audio.updateClips";
  readonly clips: readonly AudioClip[];
}

/**
 * Removes the timeline range from `start` to `end`, trimming the clips at
 * its edges. A range inside one clip splits it: the part after the range
 * takes `newKey`.
 *
 * @public
 */
export interface AudioDeleteRangeCommand {
  readonly type: "audio.deleteRange";
  /** The first timeline frame removed, inclusive. */
  readonly start: number;
  /** The timeline frame the range stops before, exclusive. */
  readonly end: number;
  /** The key of the part after the range, when the range is inside one clip. Required only then. */
  readonly newKey?: string;
}

/**
 * Changes the range of its source a clip plays. Fades that no longer fit
 * are shortened in proportion.
 *
 * @public
 */
export interface AudioTrimClipCommand {
  readonly type: "audio.trimClip";
  readonly key: string;
  /** The first source frame, inclusive. */
  readonly start: number;
  /** The source frame the clip stops before, exclusive. */
  readonly end: number;
}

/**
 * Splits a clip in two at a timeline frame inside it. The first part keeps
 * the clip's key and fade in, and the second takes `newKey` and the fade out.
 *
 * @public
 */
export interface AudioSplitClipCommand {
  readonly type: "audio.splitClip";
  readonly key: string;
  /** A timeline frame strictly inside the clip. */
  readonly at: number;
  readonly newKey: string;
}

/**
 * Moves clips, keeping their relative order, so that the first of them
 * ends up at index `to` of the resulting plan.
 *
 * @public
 */
export interface AudioMoveClipsCommand {
  readonly type: "audio.moveClips";
  readonly keys: readonly string[];
  readonly to: number;
}

/**
 * Puts every clip in a new order, given as every key exactly once. It's
 * what undoing a move runs.
 *
 * @public
 */
export interface AudioReorderClipsCommand {
  readonly type: "audio.reorderClips";
  readonly order: readonly string[];
}

/**
 * Sets the gain of clips.
 *
 * @public
 */
export interface AudioSetGainCommand {
  readonly type: "audio.setGain";
  readonly keys: readonly string[];
  /** Decibels, from `MIN_GAIN_DB` to `MAX_GAIN_DB`. */
  readonly gainDb: number;
}

/**
 * Sets a clip's fade in or fade out. Together, the two fades must fit in
 * the clip.
 *
 * @public
 */
export interface AudioSetFadeCommand {
  readonly type: "audio.setFade";
  readonly key: string;
  readonly edge: "in" | "out";
  /** The fade's length in frames. 0 removes it. */
  readonly frames: number;
  readonly curve: AudioFadeCurve;
}

/**
 * Sets one metadata field, which export writes into the file.
 *
 * @public
 */
export interface AudioSetMetadataCommand {
  readonly type: "audio.setMetadata";
  readonly field: keyof AudioMetadata;
  /** At most {@link MAX_METADATA_LENGTH} code points. */
  readonly value: string;
}

/**
 * An edit to the clip plan (docs/adr/0003). Commands are plain,
 * structured-cloneable data, never carry samples, and each has an exact
 * inverse, which is how undo works (ADR 0010, ADR 0029).
 *
 * @public
 */
export type AudioCommand =
  | AudioInsertClipsCommand
  | AudioRemoveClipsCommand
  | AudioRestoreClipsCommand
  | AudioReplaceClipsCommand
  | AudioUpdateClipsCommand
  | AudioDeleteRangeCommand
  | AudioTrimClipCommand
  | AudioSplitClipCommand
  | AudioMoveClipsCommand
  | AudioReorderClipsCommand
  | AudioSetGainCommand
  | AudioSetFadeCommand
  | AudioSetMetadataCommand;

/**
 * The longest metadata value, in Unicode code points, so that history steps
 * stay small. Code points are what JSON Schema's `maxLength` counts, and
 * what every language can count, so the limit is the same in every port
 * (sdk-core ADR 0045): 1,000 emoji fit, though they're 2,000 UTF-16 units.
 *
 * @public
 */
export const MAX_METADATA_LENGTH = 1_000;

/**
 * Whether text has more than `max` code points, counted with `for…of`,
 * which walks code points, and stopping as soon as it knows.
 *
 * @internal
 */
export function longerThan(text: string, max: number): boolean {
  // Every code point is one or two UTF-16 units.
  if (text.length <= max) return false;
  let count = 0;
  for (const _ of text) {
    count += 1;
    if (count > max) return true;
  }
  return false;
}

const CURVES: ReadonlySet<string> = new Set<AudioFadeCurve>(["linear", "equalPower"]);

/**
 * The frames of each registered source, or `undefined` for an id the
 * session doesn't have. Sources never change, so the reducer stays pure.
 *
 * @internal
 */
export type SourceFrames = (source: string) => number | undefined;

/**
 * Why the reducer refused a command, as a stable token: `details.reason` on
 * `INVALID_COMMAND`, which hosts and conformance vectors compare instead of
 * the message (sdk-core ADR 0045). Tokens never change meaning once
 * released.
 *
 * - The clip's own problems, {@link AudioClipProblem}.
 * - `malformed-command`: the command isn't shaped as its type says, such as
 *   a list that isn't one, or a clip without a key or source.
 * - `unknown-command`: its `type` isn't one of {@link AudioCommand}'s.
 * - `unknown-source`: a clip names a source the session doesn't hold.
 * - `invalid-fade-curve`: a fade's curve isn't `linear` or `equalPower`.
 * - `no-clips`: the command needs at least one clip, and names none.
 * - `duplicate-key`: it names a clip twice, or gives two new clips one key.
 * - `key-taken`: a new clip's key is already in the plan.
 * - `unknown-clip`: it names a clip the plan doesn't have.
 * - `frame-outside-plan`: a timeline frame is outside the plan.
 * - `empty-range`: a range is shorter than one frame.
 * - `not-inside-clip`: a split frame isn't strictly inside its clip.
 * - `new-key-required`: it cuts a clip in two without the new part's key.
 * - `invalid-index`: an index or a run of clips is outside the plan.
 * - `empty-change`: it would change nothing at all.
 * - `invalid-order`: a new order doesn't list every clip exactly once.
 * - `invalid-edge`: a fade's edge isn't `in` or `out`.
 * - `unknown-metadata-field`: the metadata has no such field.
 * - `metadata-too-long`: a metadata value is over {@link MAX_METADATA_LENGTH}
 *   code points.
 *
 * The session adds `no-recording`, for a command or an export with no
 * recording open, `not-plain-data`, for a command that can't be cloned, and
 * `empty-plan`, for an export of a plan with no clips.
 *
 * @public
 */
export type AudioCommandRejection =
  | AudioClipProblem
  | "malformed-command"
  | "unknown-command"
  | "unknown-source"
  | "invalid-fade-curve"
  | "no-clips"
  | "duplicate-key"
  | "key-taken"
  | "unknown-clip"
  | "frame-outside-plan"
  | "empty-range"
  | "not-inside-clip"
  | "new-key-required"
  | "invalid-index"
  | "empty-change"
  | "invalid-order"
  | "invalid-edge"
  | "unknown-metadata-field"
  | "metadata-too-long"
  | "no-recording"
  | "not-plain-data"
  | "empty-plan";

/**
 * A refusal with its reason, before it becomes the caller's `AudioError`.
 *
 * @internal
 */
export class Invalid extends Error {
  readonly reason: AudioCommandRejection;

  constructor(reason: AudioCommandRejection, message: string) {
    super(message);
    this.reason = reason;
  }
}

/** @internal */
export function invalid(reason: AudioCommandRejection, message: string): never {
  throw new Invalid(reason, message);
}

/** An object whose fields, from a command that may have been stored or sent, are unchecked. */
export type Unchecked<T> = { readonly [Key in keyof T]?: unknown };

/** @internal */
export function isRecord<T>(value: unknown): value is Unchecked<T> {
  return typeof value === "object" && value !== null;
}

/** @internal */
export function isKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isIndex(value: unknown, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
}

function fade(value: unknown, name: string): AudioFade {
  if (!isRecord<AudioFade>(value)) invalid("malformed-command", `${name} isn't a fade`);
  onlyFields(value, FADE_FIELDS, name);
  if (typeof value.curve !== "string" || !CURVES.has(value.curve)) {
    invalid("invalid-fade-curve", `${name}'s curve isn't linear or equalPower`);
  }
  return { frames: value.frames as number, curve: value.curve as AudioFadeCurve };
}

/**
 * The fields each command may have. Anything else fails as
 * `malformed-command`, as the format's JSON Schema refuses it, so that the
 * reducer accepts exactly what the schema does (sdk-core ADR 0045). A field
 * whose value is `undefined` counts as absent.
 */
const COMMAND_FIELDS: Readonly<Record<AudioCommand["type"], readonly string[]>> = {
  "audio.insertClips": ["at", "clips", "splitKey"],
  "audio.removeClips": ["keys"],
  "audio.restoreClips": ["entries"],
  "audio.replaceClips": ["index", "count", "clips"],
  "audio.updateClips": ["clips"],
  "audio.deleteRange": ["start", "end", "newKey"],
  "audio.trimClip": ["key", "start", "end"],
  "audio.splitClip": ["key", "at", "newKey"],
  "audio.moveClips": ["keys", "to"],
  "audio.reorderClips": ["order"],
  "audio.setGain": ["keys", "gainDb"],
  "audio.setFade": ["key", "edge", "frames", "curve"],
  "audio.setMetadata": ["field", "value"],
};
const CLIP_FIELDS = ["key", "source", "start", "end", "gainDb", "fadeIn", "fadeOut"];
const FADE_FIELDS = ["frames", "curve"];
const ENTRY_FIELDS = ["index", "clip"];

/** Fails unless every field the object has is one of `allowed`. */
/** @internal */
export function onlyFields(value: object, allowed: readonly string[], what: string): void {
  for (const [field, content] of Object.entries(value)) {
    if (content !== undefined && !allowed.includes(field)) {
      invalid("malformed-command", `${what} has no field ${field}`);
    }
  }
}

/** Fails unless an optional key, when it's there, is a non-empty string. */
function optionalKey(value: unknown, name: string): string | undefined {
  if (value !== undefined && !isKey(value)) {
    invalid("malformed-command", `${name} must be a non-empty string`);
  }
  return value;
}

/**
 * A clean copy of a clip from a command, with only its own fields, or a
 * failure if it isn't valid within its source.
 */
/** @internal */
export function checkClip(value: unknown, sourceFrames: SourceFrames): AudioClip {
  if (!isRecord<AudioClip>(value) || !isKey(value.key) || !isKey(value.source)) {
    invalid("malformed-command", "a clip needs a key and a source");
  }
  onlyFields(value, CLIP_FIELDS, "a clip");
  const clip: AudioClip = {
    key: value.key,
    source: value.source,
    start: value.start as number,
    end: value.end as number,
    gainDb: value.gainDb as number,
    fadeIn: fade(value.fadeIn, "fadeIn"),
    fadeOut: fade(value.fadeOut, "fadeOut"),
  };
  const frames = sourceFrames(clip.source);
  if (frames === undefined) invalid("unknown-source", `the session has no source ${clip.source}`);
  const problem = clipProblem(clip, frames);
  if (problem) invalid(problem, `clip ${clip.key} isn't valid within its source`);
  return clip;
}

function checkClips(values: unknown, sourceFrames: SourceFrames): AudioClip[] {
  if (!Array.isArray(values)) invalid("malformed-command", "clips must be a list");
  return values.map((value) => checkClip(value, sourceFrames));
}

/** Fails unless every key is new: absent from `existing`, and not repeated. */
function checkNewKeys(keys: readonly unknown[], existing: Iterable<string>): void {
  const taken = new Set(existing);
  const seen = new Set<string>();
  for (const key of keys) {
    if (!isKey(key)) invalid("malformed-command", "a key must be a non-empty string");
    if (taken.has(key)) invalid("key-taken", `the key ${key} is taken`);
    if (seen.has(key)) invalid("duplicate-key", `the key ${key} appears twice`);
    seen.add(key);
  }
}

/** The indexes of the given keys, in plan order, failing on unknown or repeated keys. */
function positions(plan: AudioPlan, keys: unknown): number[] {
  if (!Array.isArray(keys)) invalid("malformed-command", "keys must be a list");
  if (keys.length === 0) invalid("no-clips", "it needs at least one clip");
  const wanted = new Set<unknown>(keys);
  if (wanted.size !== keys.length) invalid("duplicate-key", "a clip appears twice");
  const found: number[] = [];
  plan.clips.forEach((clip, index) => {
    if (wanted.has(clip.key)) found.push(index);
  });
  if (found.length !== wanted.size) invalid("unknown-clip", "the plan doesn't have every clip");
  return found;
}

function position(plan: AudioPlan, key: unknown): number {
  return positions(plan, [key])[0] as number;
}

/**
 * Shortens fades that no longer fit their clip, in proportion, so that
 * neither reaches into the other.
 */
function fitFades(clip: AudioClip): AudioClip {
  const length = clipLength(clip);
  const total = clip.fadeIn.frames + clip.fadeOut.frames;
  // A clip of no frames, or of invalid ones, is left for validation to
  // refuse with its own reason.
  if (total <= length || !(length > 0)) return clip;
  return {
    ...clip,
    fadeIn: { ...clip.fadeIn, frames: Math.floor((clip.fadeIn.frames * length) / total) },
    fadeOut: { ...clip.fadeOut, frames: Math.floor((clip.fadeOut.frames * length) / total) },
  };
}

/**
 * The part of a clip from `from` to `to`, in frames from its start. A part
 * keeps the fades of the edges it shares with the clip, and has none at a
 * cut.
 */
function part(clip: AudioClip, from: number, to: number, key: string): AudioClip {
  const length = clipLength(clip);
  return fitFades({
    ...clip,
    key,
    start: clip.start + from,
    end: clip.start + to,
    fadeIn: from === 0 ? clip.fadeIn : NO_FADE,
    fadeOut: to === length ? clip.fadeOut : NO_FADE,
  });
}

/**
 * Where a timeline frame falls: the index of the clip that contains it and
 * the offset into that clip, or the index after the last clip, at offset 0,
 * for the plan's end.
 */
function locate(plan: AudioPlan, frame: unknown): { index: number; offset: number } {
  if (!isIndex(frame, planLength(plan))) {
    invalid("frame-outside-plan", "the frame is outside the plan");
  }
  // A valid frame past every clip is the plan's end, where locate finds none.
  const found = locateIn(clipBoundaries(plan), frame);
  return found
    ? { index: found.index, offset: found.within }
    : { index: plan.clips.length, offset: 0 };
}

function withClips(plan: AudioPlan, clips: readonly AudioClip[]): AudioPlan {
  return { ...plan, clips };
}

function splice(
  plan: AudioPlan,
  index: number,
  count: number,
  clips: readonly AudioClip[],
): AudioPlan {
  return withClips(plan, [
    ...plan.clips.slice(0, index),
    ...clips,
    ...plan.clips.slice(index + count),
  ]);
}

function updateByKey(plan: AudioPlan, clips: readonly AudioClip[]): AudioPlan {
  const byKey = new Map(clips.map((clip) => [clip.key, clip]));
  return withClips(
    plan,
    plan.clips.map((clip) => byKey.get(clip.key) ?? clip),
  );
}

type Applied = { state: AudioPlan; inverse: AudioCommand };

function apply(plan: AudioPlan, command: AudioCommand, sourceFrames: SourceFrames): Applied {
  if (!isRecord<AudioCommand>(command)) invalid("malformed-command", "a command is an object");
  const fields = Object.hasOwn(COMMAND_FIELDS, command.type as string)
    ? COMMAND_FIELDS[command.type as AudioCommand["type"]]
    : undefined;
  if (!fields) invalid("unknown-command", "unknown command");
  onlyFields(command, ["type", ...fields], command.type as string);
  switch (command.type) {
    case "audio.insertClips": {
      const clips = checkClips(command.clips, sourceFrames);
      if (clips.length === 0) invalid("no-clips", "it needs at least one clip");
      const keys = clips.map((clip) => clip.key);
      checkNewKeys(
        keys,
        plan.clips.map((clip) => clip.key),
      );
      const splitKey = optionalKey(command.splitKey, "splitKey");
      const { index, offset } = locate(plan, command.at);
      if (offset === 0) {
        return {
          state: splice(plan, index, 0, clips),
          inverse: { type: "audio.replaceClips", index, count: clips.length, clips: [] },
        };
      }
      if (splitKey === undefined) {
        invalid("new-key-required", "inserting inside a clip needs a splitKey");
      }
      checkNewKeys([splitKey], [...plan.clips.map((clip) => clip.key), ...keys]);
      const split = plan.clips[index] as AudioClip;
      const parts = [
        part(split, 0, offset, split.key),
        ...clips,
        part(split, offset, clipLength(split), splitKey),
      ];
      return {
        state: splice(plan, index, 1, parts),
        inverse: { type: "audio.replaceClips", index, count: parts.length, clips: [split] },
      };
    }

    case "audio.removeClips": {
      const at = positions(plan, command.keys);
      const removed = new Set(at);
      return {
        state: withClips(
          plan,
          plan.clips.filter((_, index) => !removed.has(index)),
        ),
        inverse: {
          type: "audio.restoreClips",
          entries: at.map((index) => ({ index, clip: plan.clips[index] as AudioClip })),
        },
      };
    }

    case "audio.restoreClips": {
      if (!Array.isArray(command.entries)) invalid("malformed-command", "entries must be a list");
      if (command.entries.length === 0) invalid("no-clips", "it needs at least one clip");
      const entries = command.entries.map((entry: unknown) => {
        if (!isRecord<{ index: number; clip: AudioClip }>(entry)) {
          invalid("malformed-command", "an entry needs an index and a clip");
        }
        onlyFields(entry, ENTRY_FIELDS, "an entry");
        return { index: entry.index, clip: checkClip(entry.clip, sourceFrames) };
      });
      checkNewKeys(
        entries.map(({ clip }) => clip.key),
        plan.clips.map((clip) => clip.key),
      );
      const clips = [...plan.clips];
      let previous = -1;
      for (const { index, clip } of entries) {
        if (!isIndex(index, clips.length) || index <= previous) {
          invalid("invalid-index", `clip ${clip.key} can't be restored at index ${String(index)}`);
        }
        clips.splice(index, 0, clip);
        previous = index;
      }
      return {
        state: withClips(plan, clips),
        inverse: { type: "audio.removeClips", keys: entries.map(({ clip }) => clip.key) },
      };
    }

    case "audio.replaceClips": {
      const { index, count } = command;
      if (!isIndex(index, plan.clips.length) || !isIndex(count, plan.clips.length - index)) {
        invalid("invalid-index", "the run of clips is outside the plan");
      }
      const clips = checkClips(command.clips, sourceFrames);
      if (count === 0 && clips.length === 0) invalid("empty-change", "it changes nothing");
      const removed = plan.clips.slice(index, index + count);
      checkNewKeys(
        clips.map((clip) => clip.key),
        [...plan.clips.slice(0, index), ...plan.clips.slice(index + count)].map((clip) => clip.key),
      );
      return {
        state: splice(plan, index, count, clips),
        inverse: { type: "audio.replaceClips", index, count: clips.length, clips: removed },
      };
    }

    case "audio.updateClips": {
      const clips = checkClips(command.clips, sourceFrames);
      const at = positions(
        plan,
        clips.map((clip) => clip.key),
      );
      return {
        state: updateByKey(plan, clips),
        inverse: {
          type: "audio.updateClips",
          clips: at.map((index) => plan.clips[index] as AudioClip),
        },
      };
    }

    case "audio.deleteRange": {
      const { start, end } = command;
      const newKey = optionalKey(command.newKey, "newKey");
      if (!isIndex(start, planLength(plan)) || !isIndex(end, planLength(plan))) {
        invalid("frame-outside-plan", "the range must be inside the plan");
      }
      if (end <= start) invalid("empty-range", "the range must be at least one frame long");
      const first = locate(plan, start);
      const last = locate(plan, end - 1);
      const firstClip = plan.clips[first.index] as AudioClip;
      const lastClip = plan.clips[last.index] as AudioClip;
      const kept: AudioClip[] = [];
      if (first.offset > 0) kept.push(part(firstClip, 0, first.offset, firstClip.key));
      if (last.offset + 1 < clipLength(lastClip)) {
        let key = lastClip.key;
        if (first.index === last.index && first.offset > 0) {
          if (newKey === undefined) {
            invalid("new-key-required", "deleting inside a clip needs a newKey");
          }
          checkNewKeys(
            [newKey],
            plan.clips.map((clip) => clip.key),
          );
          key = newKey;
        }
        kept.push(part(lastClip, last.offset + 1, clipLength(lastClip), key));
      }
      const count = last.index - first.index + 1;
      return {
        state: splice(plan, first.index, count, kept),
        inverse: {
          type: "audio.replaceClips",
          index: first.index,
          count: kept.length,
          clips: plan.clips.slice(first.index, first.index + count),
        },
      };
    }

    case "audio.trimClip": {
      const index = position(plan, command.key);
      const clip = plan.clips[index] as AudioClip;
      const trimmed = checkClip(
        fitFades({ ...clip, start: command.start, end: command.end }),
        sourceFrames,
      );
      return {
        state: updateByKey(plan, [trimmed]),
        inverse: { type: "audio.updateClips", clips: [clip] },
      };
    }

    case "audio.splitClip": {
      const index = position(plan, command.key);
      const clip = plan.clips[index] as AudioClip;
      const { index: within, offset } = locate(plan, command.at);
      if (within !== index || offset === 0) {
        invalid("not-inside-clip", "the frame must be strictly inside the clip");
      }
      checkNewKeys(
        [command.newKey],
        plan.clips.map((entry) => entry.key),
      );
      const parts = [
        part(clip, 0, offset, clip.key),
        part(clip, offset, clipLength(clip), command.newKey),
      ];
      return {
        state: splice(plan, index, 1, parts),
        inverse: { type: "audio.replaceClips", index, count: 2, clips: [clip] },
      };
    }

    case "audio.moveClips": {
      const moved = new Set(positions(plan, command.keys));
      const block = plan.clips.filter((_, index) => moved.has(index));
      const rest = plan.clips.filter((_, index) => !moved.has(index));
      if (!isIndex(command.to, rest.length)) invalid("invalid-index", "the clips can't move there");
      return {
        state: withClips(plan, [...rest.slice(0, command.to), ...block, ...rest.slice(command.to)]),
        inverse: { type: "audio.reorderClips", order: plan.clips.map((clip) => clip.key) },
      };
    }

    case "audio.reorderClips": {
      const { order } = command;
      const byKey = new Map(plan.clips.map((clip) => [clip.key, clip]));
      if (
        !Array.isArray(order) ||
        order.length !== plan.clips.length ||
        new Set(order).size !== order.length ||
        order.some((key) => !byKey.has(key))
      ) {
        invalid("invalid-order", "the order must list every clip exactly once");
      }
      return {
        state: withClips(
          plan,
          order.map((key) => byKey.get(key) as AudioClip),
        ),
        inverse: { type: "audio.reorderClips", order: plan.clips.map((clip) => clip.key) },
      };
    }

    case "audio.setGain": {
      const at = positions(plan, command.keys);
      const gainDb = command.gainDb;
      if (typeof gainDb !== "number" || !(gainDb >= MIN_GAIN_DB && gainDb <= MAX_GAIN_DB)) {
        invalid("gain-out-of-range", `gain must be from ${MIN_GAIN_DB} to ${MAX_GAIN_DB} dB`);
      }
      const before = at.map((index) => plan.clips[index] as AudioClip);
      return {
        state: updateByKey(
          plan,
          before.map((clip) => ({ ...clip, gainDb })),
        ),
        inverse: { type: "audio.updateClips", clips: before },
      };
    }

    case "audio.setFade": {
      const clip = plan.clips[position(plan, command.key)] as AudioClip;
      const { edge, frames } = command;
      if (edge !== "in" && edge !== "out") invalid("invalid-edge", "the edge must be in or out");
      const next = { frames, curve: fade({ frames, curve: command.curve }, "the fade").curve };
      const updated = checkClip(
        edge === "in" ? { ...clip, fadeIn: next } : { ...clip, fadeOut: next },
        sourceFrames,
      );
      return {
        state: updateByKey(plan, [updated]),
        inverse: { type: "audio.updateClips", clips: [clip] },
      };
    }

    case "audio.setMetadata": {
      const { field, value } = command;
      if (typeof field !== "string" || !Object.hasOwn(EMPTY_METADATA, field)) {
        invalid("unknown-metadata-field", "there's no such metadata field");
      }
      if (typeof value !== "string") invalid("malformed-command", "a metadata value must be text");
      if (longerThan(value, MAX_METADATA_LENGTH)) {
        invalid(
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
      return invalid("unknown-command", "unknown command");
  }
}

/**
 * Creates the clip plan's reducer (docs/adr/0003): it applies one command
 * without changing the plan, and returns the new plan with the command's
 * inverse. Sources are looked up through `sourceFrames`, so commands never
 * carry samples. An invalid command throws `AudioError` with
 * `INVALID_COMMAND` and changes nothing: the reducer never corrects one.
 *
 * @internal
 */
export function createPlanReducer(sourceFrames: SourceFrames): Reducer<AudioPlan, AudioCommand> {
  return (plan, command) => {
    try {
      return apply(plan, command, sourceFrames);
    } catch (error) {
      if (!(error instanceof Invalid)) throw error;
      const type =
        isRecord<AudioCommand>(command) && typeof command.type === "string" ? command.type : "";
      const known = type.startsWith("audio.") && type.length <= 64;
      throw new AudioError(
        "INVALID_COMMAND",
        `Invalid ${known ? type : "command"}: ${error.message}.`,
        { details: known ? { command: type, reason: error.reason } : { reason: error.reason } },
      );
    }
  };
}
