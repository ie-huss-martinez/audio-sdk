import { AudioError } from "../errors/audio-error.js";
import type {
  AudioClip,
  AudioClipBody,
  AudioMetadata,
  AudioPlan,
  AudioTrack,
} from "../model/plan.js";
import {
  checkClipBody,
  Invalid,
  invalid,
  isKey,
  isRecord,
  onlyFields,
} from "../operations/checks.js";
import { type AudioUserCommand, refuse } from "../operations/commands.js";
import {
  AUDIO_PLAN_FORMAT,
  type AudioPlanDocumentSource,
  isCount,
  malformed,
  readMetadata,
  readSources,
} from "./document-parts.js";

/**
 * Version 1 of the plan (docs/adr/0003): one track of clips played back to
 * back. The package reads version 1 documents and commands, and migrates
 * them to version 2 (docs/adr/0006, docs/formats/hm-audio-plan.md). It
 * writes version 2 only.
 */

/**
 * A clip of a version 1 plan: a range of a source, with no position of its
 * own. Its place was the sum of the lengths of the clips before it.
 *
 * @public
 */
export type AudioClipV1 = AudioClipBody;

/**
 * A version 1 plan: clips played back to back on one track.
 *
 * @public
 */
export interface AudioPlanV1 {
  readonly sampleRate: number;
  readonly channels: number;
  readonly clips: readonly AudioClipV1[];
  readonly metadata: AudioMetadata;
}

/** `hm-audio-plan` version 1, which `formats/hm-audio-plan/v1.schema.json` describes. */
interface AudioPlanDocumentV1 extends AudioPlanV1 {
  readonly format: typeof AUDIO_PLAN_FORMAT;
  readonly version: 1;
  readonly sources: Readonly<Record<string, AudioPlanDocumentSource>>;
}

const DOCUMENT_FIELDS = [
  "format",
  "version",
  "sampleRate",
  "channels",
  "sources",
  "clips",
  "metadata",
];

function readVersion1(value: unknown): {
  plan: AudioPlanV1;
  sources: Record<string, AudioPlanDocumentSource>;
} {
  if (!isRecord<AudioPlanDocumentV1>(value) || Array.isArray(value)) {
    malformed("a document is an object");
  }
  const { format, version } = value;
  if (typeof format !== "string") malformed("format is text");
  if (format !== AUDIO_PLAN_FORMAT) {
    throw new AudioError("UNSUPPORTED_FORMAT", `This isn't an ${AUDIO_PLAN_FORMAT} document.`, {
      details: { format: AUDIO_PLAN_FORMAT, reason: "unknown-format" },
    });
  }
  if (Number.isSafeInteger(version) && (version as number) > 1) {
    throw new AudioError(
      "UNSUPPORTED_FORMAT",
      `This ${AUDIO_PLAN_FORMAT} document is a later version than this release reads.`,
      { details: { format: AUDIO_PLAN_FORMAT, reason: "unknown-format-version" } },
    );
  }
  if (version !== 1) malformed("version is 1");
  onlyFields(value, DOCUMENT_FIELDS, "a document");
  if (!isCount(value.sampleRate, 1)) malformed("sampleRate is a whole number above 0");
  if (!isCount(value.channels, 1)) malformed("channels is a whole number above 0");
  const sources = readSources(value.sources);
  if (!Array.isArray(value.clips)) malformed("clips is a list");
  const lookup = (id: string) => (Object.hasOwn(sources, id) ? sources[id]?.frames : undefined);
  const clips = value.clips.map((clip: unknown) => checkClipBody(clip, lookup));
  const keys = new Set<string>();
  for (const { key } of clips) {
    if (keys.has(key)) invalid("duplicate-key", `two clips have the key ${key}`);
    keys.add(key);
  }
  return {
    plan: {
      sampleRate: value.sampleRate,
      channels: value.channels,
      clips,
      metadata: readMetadata(value.metadata),
    },
    sources,
  };
}

/**
 * Reads a version 1 document, checked as version 1's schema does and more.
 *
 * @throws `AudioError` with `INVALID_DOCUMENT`, as the version 2 reader.
 * @internal
 */
export function readPlanDocumentV1(value: unknown): {
  readonly plan: AudioPlanV1;
  readonly sources: Readonly<Record<string, AudioPlanDocumentSource>>;
} {
  try {
    return readVersion1(value);
  } catch (error) {
    if (!(error instanceof Invalid)) throw error;
    const reason = error.reason === "malformed-command" ? "malformed-document" : error.reason;
    throw new AudioError(
      "INVALID_DOCUMENT",
      `Invalid ${AUDIO_PLAN_FORMAT} document: ${error.message}.`,
      { details: { format: AUDIO_PLAN_FORMAT, reason } },
    );
  }
}

/** The key a migrated plan's one track takes: `t1`, or the first of `t2`, `t3`… that no clip has. */
function trackKeyFor(clips: readonly AudioClipV1[]): string {
  const taken = new Set(clips.map((clip) => clip.key));
  let number = 1;
  while (taken.has(`t${number}`)) number += 1;
  return `t${number}`;
}

/**
 * Migrates a version 1 plan: one track, unnamed, at 0 dB, holding the clips
 * back to back from the start, as version 1 played them, under a master
 * gain of 0 dB. It's pure and total: every version 1 plan has exactly one
 * version 2 plan.
 *
 * @public
 */
export function migratePlan(plan: AudioPlanV1): AudioPlan {
  let at = 0;
  const clips = plan.clips.map((clip): AudioClip => {
    const placed = {
      key: clip.key,
      at,
      source: clip.source,
      start: clip.start,
      end: clip.end,
      gainDb: clip.gainDb,
      fadeIn: clip.fadeIn,
      fadeOut: clip.fadeOut,
    };
    at += clip.end - clip.start;
    return placed;
  });
  return {
    sampleRate: plan.sampleRate,
    channels: plan.channels,
    gainDb: 0,
    tracks: [
      { key: trackKeyFor(plan.clips), name: "", gainDb: 0, muted: false, soloed: false, clips },
    ],
    metadata: plan.metadata,
  };
}

/** The shapes of version 1's user commands, as far as migrating them needs. */
type AudioCommandV1 =
  | { type: "audio.insertClips"; at: number; clips: readonly AudioClipV1[]; splitKey?: string }
  | { type: "audio.removeClips"; keys: readonly string[] }
  | { type: "audio.deleteRange"; start: number; end: number; newKey?: string }
  | { type: "audio.trimClip"; key: string; start: number; end: number }
  | { type: "audio.splitClip"; key: string; at: number; newKey: string }
  | { type: "audio.moveClips"; keys: readonly string[]; to: number }
  | Extract<AudioUserCommand, { type: "audio.setGain" | "audio.setFade" | "audio.setMetadata" }>;

const isWhole = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

/**
 * Migrates a version 1 command to the version 2 commands with the same
 * effect, on the plan a version 1 document migrates to: its first track
 * holds what version 1's single track held.
 *
 * Version 1's commands closed gaps as they went, and version 2's clip edits
 * never move another clip. So an edit that changed a clip's length, or the
 * clips' order, becomes that edit with the time edits that close or open
 * the gap: `audio.insertTime`, and `audio.deleteRange` with `ripple`. Run
 * the result as one undo step.
 *
 * A command the plan can't take is returned as the nearest version 2
 * command, which the reducer then refuses, or refused here with
 * `INVALID_COMMAND` when it names clips the plan doesn't have.
 *
 * @public
 */
export function migrateAudioCommand(command: unknown, plan: AudioPlan): AudioUserCommand[] {
  try {
    return migrate(command, plan);
  } catch (error) {
    if (!(error instanceof Invalid)) throw error;
    throw new AudioError("INVALID_COMMAND", `Invalid command: ${error.message}.`, {
      details: { reason: error.reason },
    });
  }
}

function migrate(value: unknown, plan: AudioPlan): AudioUserCommand[] {
  if (!isRecord<AudioCommandV1>(value)) refuse("malformed-command", "a command is an object");
  const track = plan.tracks[0] as AudioTrack;
  const tracks = [track.key];
  const command = value as AudioCommandV1;
  const ripple = (start: number, end: number, newKey?: string): AudioUserCommand => ({
    type: "audio.deleteRange",
    start,
    end,
    tracks,
    ripple: true,
    ...(newKey === undefined ? {} : { newKeys: Object.fromEntries([[track.key, newKey]]) }),
  });
  const open = (at: number, frames: number, newKey?: string): AudioUserCommand => ({
    type: "audio.insertTime",
    at,
    frames,
    tracks,
    ...(newKey === undefined ? {} : { newKeys: Object.fromEntries([[track.key, newKey]]) }),
  });
  /** The named clips, in time order, or a failure. */
  const find = (keys: unknown): AudioClip[] => {
    if (!Array.isArray(keys)) refuse("malformed-command", "keys must be a list");
    if (keys.length === 0) refuse("no-clips", "it needs at least one clip");
    if (new Set(keys).size !== keys.length) refuse("duplicate-key", "a clip appears twice");
    const found = track.clips.filter((clip) => keys.includes(clip.key));
    if (found.length !== keys.length) refuse("unknown-clip", "the plan doesn't have every clip");
    return found;
  };
  const lengthOf = (clip: AudioClipBody) => clip.end - clip.start;

  switch (command.type) {
    case "audio.insertClips": {
      const { at, clips, splitKey } = command as { at: unknown; clips: unknown; splitKey?: string };
      onlyFields(command, ["type", "at", "clips", "splitKey"], command.type);
      if (splitKey !== undefined && !isKey(splitKey)) {
        refuse("malformed-command", "splitKey must be a non-empty string");
      }
      if (!Array.isArray(clips)) refuse("malformed-command", "clips must be a list");
      if (clips.length === 0) refuse("no-clips", "it needs at least one clip");
      // The clips go back to back from the frame, in the room opened for
      // them. Clips that aren't valid are left for the reducer to refuse.
      let next = isWhole(at) ? at : 0;
      let total = 0;
      const placed = clips.map((clip: unknown) => {
        const length =
          isRecord<AudioClipBody>(clip) && isWhole(clip.start) && isWhole(clip.end)
            ? Math.max(0, clip.end - clip.start)
            : 0;
        const positioned = { ...(clip as object), at: next };
        next += length;
        total += length;
        return positioned as AudioClip;
      });
      const insert: AudioUserCommand = {
        type: "audio.insertClips",
        track: track.key,
        clips: placed,
      };
      // A frame inside a clip splits it; at a boundary the key isn't used.
      return total > 0 ? [open(at as number, total, splitKey), insert] : [insert];
    }

    case "audio.removeClips": {
      onlyFields(command, ["type", "keys"], command.type);
      // From the last to the first, so each range is still where it was.
      return find(command.keys)
        .reverse()
        .map((clip) => ripple(clip.at, clip.at + lengthOf(clip)));
    }

    case "audio.deleteRange": {
      onlyFields(command, ["type", "start", "end", "newKey"], command.type);
      return [ripple(command.start, command.end, command.newKey)];
    }

    case "audio.trimClip": {
      onlyFields(command, ["type", "key", "start", "end"], command.type);
      const { key, start, end } = command;
      const trim: AudioUserCommand = { type: "audio.trimClip", key, start, end };
      const clip = track.clips.find((entry) => entry.key === key);
      if (!clip || !isWhole(start) || !isWhole(end) || end <= start) return [trim];
      // Version 1 kept the clip's place and moved what came after it.
      // Version 2 keeps the audio's place. So: open room where the clip
      // grows, trim once, then close the gaps where it shrank.
      const earlier = clip.start - start;
      const later = end - clip.end;
      const length = end - start;
      const last = track.clips.at(-1) === clip;
      const before: AudioUserCommand[] = [];
      const after: AudioUserCommand[] = [];
      if (earlier > 0) before.push(open(clip.at, earlier));
      if (later > 0 && !last) {
        before.push(open(clip.at + Math.max(earlier, 0) + lengthOf(clip), later));
      }
      if (earlier < 0) after.push(ripple(clip.at, clip.at - earlier));
      if (later < 0 && !last) after.push(ripple(clip.at + length, clip.at + length - later));
      return [...before, trim, ...after];
    }

    case "audio.splitClip": {
      onlyFields(command, ["type", "key", "at", "newKey"], command.type);
      const { key, at, newKey } = command;
      return [{ type: "audio.splitClip", key, at, newKey }];
    }

    case "audio.moveClips": {
      onlyFields(command, ["type", "keys", "to"], command.type);
      const moved = find(command.keys);
      const rest = track.clips.filter((clip) => !moved.includes(clip));
      const { to } = command;
      if (!isWhole(to) || to > rest.length) refuse("invalid-index", "the clips can't move there");
      // Take the clips out, closing the gaps, then open room for them
      // where they go, and put them there back to back.
      const removals = [...moved]
        .reverse()
        .map((clip) => ripple(clip.at, clip.at + lengthOf(clip)));
      let at = rest.slice(0, to).reduce((sum, clip) => sum + lengthOf(clip), 0);
      const from = at;
      const placed = moved.map((clip) => {
        const positioned = { ...clip, at };
        at += lengthOf(clip);
        return positioned;
      });
      return [
        ...removals,
        open(from, at - from),
        { type: "audio.insertClips", track: track.key, clips: placed },
      ];
    }

    case "audio.setGain":
    case "audio.setFade":
    case "audio.setMetadata":
      // The same in both versions.
      return [command];

    default:
      return refuse("unknown-command", "not a version 1 user command");
  }
}
