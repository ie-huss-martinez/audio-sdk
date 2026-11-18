import { AudioError } from "../errors/audio-error.js";
import type { AudioClip, AudioMetadata, AudioPlan } from "../model/plan.js";
import type { AudioTrack, AudioTrackClip, AudioTrackPlan } from "../model/tracks.js";
import { type AudioCommand, Invalid, isKey, isRecord, onlyFields } from "../operations/commands.js";
import {
  type AudioTrackUserCommand,
  checkTrack,
  checkUniqueKeys,
  refuse,
} from "../operations/track-commands.js";
import {
  AUDIO_PLAN_FORMAT,
  type AudioDocumentRejection,
  type AudioPlanDocumentSource,
  isCount,
  readAudioPlanDocument,
  readMetadata,
  readSources,
} from "./plan-document.js";

/**
 * The multitrack plan as portable JSON: `hm-audio-plan` version 2
 * (docs/adr/0006, docs/formats/hm-audio-plan.md). Internal until the
 * session runs on the multitrack plan; nothing here is exported from the
 * package yet.
 */

/**
 * The version of `hm-audio-plan` that has tracks.
 *
 * @internal
 */
export const AUDIO_TRACK_PLAN_VERSION = 2;

/**
 * `hm-audio-plan` version 2, which `formats/hm-audio-plan/v2.schema.json`
 * describes.
 *
 * @internal
 */
export interface AudioTrackPlanDocument {
  readonly format: typeof AUDIO_PLAN_FORMAT;
  readonly version: typeof AUDIO_TRACK_PLAN_VERSION;
  readonly sampleRate: number;
  readonly channels: number;
  readonly gainDb: number;
  readonly sources: Readonly<Record<string, AudioPlanDocumentSource>>;
  readonly tracks: readonly AudioTrack[];
  readonly metadata: AudioMetadata;
}

/**
 * Why a version 2 document was refused: version 1's reasons, and
 * `clips-overlap`, `clips-out-of-order`, `no-tracks` and `name-too-long`.
 *
 * @internal
 */
export type AudioTrackDocumentRejection =
  | AudioDocumentRejection
  | "clips-overlap"
  | "clips-out-of-order"
  | "no-tracks"
  | "name-too-long";

const DOCUMENT_FIELDS = [
  "format",
  "version",
  "sampleRate",
  "channels",
  "gainDb",
  "sources",
  "tracks",
  "metadata",
];

function malformed(message: string): never {
  return refuse("malformed-command", message);
}

/** The key a migrated plan's one track takes: `t1`, or the first of `t2`, `t3`… that no clip has. */
function trackKeyFor(clips: readonly AudioClip[]): string {
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
 * @internal
 */
export function migratePlan(plan: AudioPlan): AudioTrackPlan {
  let at = 0;
  const clips = plan.clips.map((clip): AudioTrackClip => {
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

function read(value: unknown): {
  plan: AudioTrackPlan;
  sources: Readonly<Record<string, AudioPlanDocumentSource>>;
} {
  if (!isRecord<AudioTrackPlanDocument>(value) || Array.isArray(value)) {
    malformed("a document is an object");
  }
  const { format, version } = value;
  if (typeof format !== "string") malformed("format is text");
  if (format !== AUDIO_PLAN_FORMAT) {
    throw new AudioError("UNSUPPORTED_FORMAT", `This isn't an ${AUDIO_PLAN_FORMAT} document.`, {
      details: { format: AUDIO_PLAN_FORMAT, reason: "unknown-format" },
    });
  }
  if (Number.isSafeInteger(version) && (version as number) > AUDIO_TRACK_PLAN_VERSION) {
    throw new AudioError(
      "UNSUPPORTED_FORMAT",
      `This ${AUDIO_PLAN_FORMAT} document is a later version than this release reads.`,
      { details: { format: AUDIO_PLAN_FORMAT, reason: "unknown-format-version" } },
    );
  }
  if (version === 1) {
    // Version 1's own reader checks it, and its plan migrates.
    const earlier = readAudioPlanDocument(value);
    return { plan: migratePlan(earlier.plan), sources: earlier.sources };
  }
  if (version !== AUDIO_TRACK_PLAN_VERSION) malformed("version is 1 or 2");
  onlyFields(value, DOCUMENT_FIELDS, "a document");
  if (!isCount(value.sampleRate, 1)) malformed("sampleRate is a whole number above 0");
  if (!isCount(value.channels, 1)) malformed("channels is a whole number above 0");
  const { gainDb } = value;
  if (typeof gainDb !== "number" || !(gainDb >= -120 && gainDb <= 120)) {
    refuse("gain-out-of-range", "the master gain must be from -120 to 120 dB");
  }
  const sources = readSources(value.sources);
  if (!Array.isArray(value.tracks)) malformed("tracks is a list");
  if (value.tracks.length === 0) refuse("no-tracks", "a plan has at least one track");
  const lookup = (id: string) => (Object.hasOwn(sources, id) ? sources[id]?.frames : undefined);
  const plan: AudioTrackPlan = {
    sampleRate: value.sampleRate,
    channels: value.channels,
    gainDb,
    tracks: value.tracks.map((track: unknown) => checkTrack(track, lookup)),
    metadata: readMetadata(value.metadata),
  };
  checkUniqueKeys(plan);
  return { plan, sources };
}

/**
 * Reads a plan document of version 1 or 2, and returns a multitrack plan:
 * a version 1 document migrates with {@link migratePlan}. It checks what
 * the schemas do and more: every clip lies within a source the document
 * lists, each track's clips are in time order and don't overlap, and keys
 * are unique. Unknown fields are refused, never dropped.
 *
 * @throws `AudioError` with `UNSUPPORTED_FORMAT` for another format or a
 *   later version, and `INVALID_DOCUMENT` for anything else that's wrong,
 *   with a {@link AudioTrackDocumentRejection} as `details.reason`.
 * @internal
 */
export function readTrackPlanDocument(value: unknown): {
  readonly plan: AudioTrackPlan;
  readonly sources: Readonly<Record<string, AudioPlanDocumentSource>>;
} {
  try {
    return read(value);
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

/**
 * Writes a multitrack plan as a version 2 document, plain JSON-ready data.
 *
 * @throws `TypeError` if a clip's source is missing from `sources`.
 * @internal
 */
export function toTrackPlanDocument(
  plan: AudioTrackPlan,
  sources: Readonly<Record<string, AudioPlanDocumentSource>>,
): AudioTrackPlanDocument {
  return {
    format: AUDIO_PLAN_FORMAT,
    version: AUDIO_TRACK_PLAN_VERSION,
    sampleRate: plan.sampleRate,
    channels: plan.channels,
    gainDb: plan.gainDb,
    sources: Object.fromEntries(
      Object.entries(sources).map(([id, { frames, asset }]) => [
        id,
        asset === undefined ? { frames } : { frames, asset: { ...asset } },
      ]),
    ),
    tracks: plan.tracks.map((track) => ({
      key: track.key,
      name: track.name,
      gainDb: track.gainDb,
      muted: track.muted,
      soloed: track.soloed,
      clips: track.clips.map((clip) => {
        if (!Object.hasOwn(sources, clip.source)) {
          throw new TypeError(
            `The sources don't include ${clip.source}, which clip ${clip.key} uses.`,
          );
        }
        return {
          key: clip.key,
          at: clip.at,
          source: clip.source,
          start: clip.start,
          end: clip.end,
          gainDb: clip.gainDb,
          fadeIn: { frames: clip.fadeIn.frames, curve: clip.fadeIn.curve },
          fadeOut: { frames: clip.fadeOut.frames, curve: clip.fadeOut.curve },
        };
      }),
    })),
    metadata: { ...plan.metadata },
  };
}

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
 * @internal
 */
export function migrateCommand(command: unknown, plan: AudioTrackPlan): AudioTrackUserCommand[] {
  try {
    return migrate(command, plan);
  } catch (error) {
    if (!(error instanceof Invalid)) throw error;
    throw new AudioError("INVALID_COMMAND", `Invalid command: ${error.message}.`, {
      details: { reason: error.reason },
    });
  }
}

function migrate(value: unknown, plan: AudioTrackPlan): AudioTrackUserCommand[] {
  if (!isRecord<AudioCommand>(value)) refuse("malformed-command", "a command is an object");
  const track = plan.tracks[0] as AudioTrack;
  const tracks = [track.key];
  const command = value as AudioCommand;
  const ripple = (start: number, end: number, newKey?: string): AudioTrackUserCommand => ({
    type: "audio.deleteRange",
    start,
    end,
    tracks,
    ripple: true,
    ...(newKey === undefined ? {} : { newKeys: Object.fromEntries([[track.key, newKey]]) }),
  });
  const open = (at: number, frames: number, newKey?: string): AudioTrackUserCommand => ({
    type: "audio.insertTime",
    at,
    frames,
    tracks,
    ...(newKey === undefined ? {} : { newKeys: Object.fromEntries([[track.key, newKey]]) }),
  });
  /** The named clips, in time order, or a failure. */
  const find = (keys: unknown): AudioTrackClip[] => {
    if (!Array.isArray(keys)) refuse("malformed-command", "keys must be a list");
    if (keys.length === 0) refuse("no-clips", "it needs at least one clip");
    if (new Set(keys).size !== keys.length) refuse("duplicate-key", "a clip appears twice");
    const found = track.clips.filter((clip) => keys.includes(clip.key));
    if (found.length !== keys.length) refuse("unknown-clip", "the plan doesn't have every clip");
    return found;
  };
  const lengthOf = (clip: AudioClip) => clip.end - clip.start;

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
          isRecord<AudioClip>(clip) && isWhole(clip.start) && isWhole(clip.end)
            ? Math.max(0, clip.end - clip.start)
            : 0;
        const positioned = { ...(clip as object), at: next };
        next += length;
        total += length;
        return positioned as AudioTrackClip;
      });
      const insert: AudioTrackUserCommand = {
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
      const trim: AudioTrackUserCommand = { type: "audio.trimClip", key, start, end };
      const clip = track.clips.find((entry) => entry.key === key);
      if (!clip || !isWhole(start) || !isWhole(end) || end <= start) return [trim];
      // Version 1 kept the clip's place and moved what came after it.
      // Version 2 keeps the audio's place. So: open room where the clip
      // grows, trim once, then close the gaps where it shrank.
      const earlier = clip.start - start;
      const later = end - clip.end;
      const length = end - start;
      const last = track.clips.at(-1) === clip;
      const before: AudioTrackUserCommand[] = [];
      const after: AudioTrackUserCommand[] = [];
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
