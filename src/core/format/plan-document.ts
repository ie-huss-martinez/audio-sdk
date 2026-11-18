import { AudioError } from "../errors/audio-error.js";
import type { AudioClipProblem, AudioMetadata, AudioPlan, AudioTrack } from "../model/plan.js";
import { Invalid, isRecord, onlyFields } from "../operations/checks.js";
import { checkTrack, checkUniqueKeys, refuse } from "../operations/commands.js";
import {
  AUDIO_PLAN_FORMAT,
  type AudioPlanDocumentSource,
  isCount,
  malformed,
  readMetadata,
  readSources,
} from "./document-parts.js";
import { migratePlan, readPlanDocumentV1 } from "./version-1.js";

/**
 * The version of {@link AUDIO_PLAN_FORMAT} this release writes, and the
 * latest it reads. It reads version 1 too, by migrating it.
 *
 * @public
 */
export const AUDIO_PLAN_VERSION = 2;

/**
 * The plan as portable JSON: `hm-audio-plan` version 2, which
 * `formats/hm-audio-plan/v2.schema.json` describes
 * (docs/formats/hm-audio-plan.md). Every position is a whole number of
 * frames, and sources are named by the ids their clips use.
 *
 * @public
 */
export interface AudioPlanDocument {
  readonly format: typeof AUDIO_PLAN_FORMAT;
  readonly version: typeof AUDIO_PLAN_VERSION;
  readonly sampleRate: number;
  readonly channels: number;
  readonly gainDb: number;
  readonly sources: Readonly<Record<string, AudioPlanDocumentSource>>;
  readonly tracks: readonly AudioTrack[];
  readonly metadata: AudioMetadata;
}

/**
 * Why a plan document was refused, as a stable token: `details.reason` on
 * the error (sdk-core ADR 0045).
 *
 * - With `UNSUPPORTED_FORMAT`: `unknown-format`, a document of another
 *   format, and `unknown-format-version`, a later version than this release
 *   reads.
 * - With `INVALID_DOCUMENT`: `malformed-document`, a document that isn't
 *   shaped as the schema says; `unknown-source`, a clip whose source the
 *   document doesn't list; `duplicate-key`, a key used twice among tracks
 *   and clips; `clips-overlap` and `clips-out-of-order`, a track whose
 *   clips aren't in time order without overlap; `no-tracks`, a plan with
 *   none; `invalid-fade-curve`, `metadata-too-long`, `name-too-long` and
 *   `gain-out-of-range`, as for commands; and a clip's own problems,
 *   {@link AudioClipProblem}.
 *
 * @public
 */
export type AudioDocumentRejection =
  | AudioClipProblem
  | "unknown-format"
  | "unknown-format-version"
  | "malformed-document"
  | "unknown-source"
  | "duplicate-key"
  | "invalid-fade-curve"
  | "metadata-too-long"
  | "name-too-long"
  | "clips-overlap"
  | "clips-out-of-order"
  | "no-tracks";

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

function read(value: unknown): {
  plan: AudioPlan;
  sources: Readonly<Record<string, AudioPlanDocumentSource>>;
} {
  if (!isRecord<AudioPlanDocument>(value) || Array.isArray(value)) {
    malformed("a document is an object");
  }
  const { format, version } = value;
  if (typeof format !== "string") malformed("format is text");
  if (format !== AUDIO_PLAN_FORMAT) {
    throw new AudioError("UNSUPPORTED_FORMAT", `This isn't an ${AUDIO_PLAN_FORMAT} document.`, {
      details: { format: AUDIO_PLAN_FORMAT, reason: "unknown-format" },
    });
  }
  if (Number.isSafeInteger(version) && (version as number) > AUDIO_PLAN_VERSION) {
    throw new AudioError(
      "UNSUPPORTED_FORMAT",
      `This ${AUDIO_PLAN_FORMAT} document is a later version than this release reads.`,
      { details: { format: AUDIO_PLAN_FORMAT, reason: "unknown-format-version" } },
    );
  }
  if (version === 1) {
    // Version 1's own reader checks it, and its plan migrates.
    const earlier = readPlanDocumentV1(value);
    return { plan: migratePlan(earlier.plan), sources: earlier.sources };
  }
  if (version !== AUDIO_PLAN_VERSION) malformed("version is 1 or 2");
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
  const plan: AudioPlan = {
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
 *   with a {@link AudioDocumentRejection} as `details.reason`.
 * @public
 */
export function readAudioPlanDocument(value: unknown): {
  readonly plan: AudioPlan;
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
 * @public
 */
export function toAudioPlanDocument(
  plan: AudioPlan,
  sources: Readonly<Record<string, AudioPlanDocumentSource>>,
): AudioPlanDocument {
  return {
    format: AUDIO_PLAN_FORMAT,
    version: AUDIO_PLAN_VERSION,
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
