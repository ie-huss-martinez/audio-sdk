import { AudioError } from "../errors/audio-error.js";
import type { AudioClip, AudioClipProblem, AudioMetadata, AudioPlan } from "../model/plan.js";
import {
  checkClip,
  Invalid,
  invalid,
  isKey,
  isRecord,
  MAX_METADATA_LENGTH,
  onlyFields,
} from "../operations/commands.js";

/**
 * The name of the clip plan's portable format (sdk-core ADR 0045).
 *
 * @public
 */
export const AUDIO_PLAN_FORMAT = "hm-audio-plan";

/**
 * The version of {@link AUDIO_PLAN_FORMAT} this release writes, and the
 * latest it reads.
 *
 * @public
 */
export const AUDIO_PLAN_VERSION = 1;

/**
 * A content-addressed reference to binary data, such as a source's file
 * (sdk-core ADR 0045). Documents never inline bytes.
 *
 * @public
 */
export interface AudioAssetReference {
  /** `sha256:` and the lowercase hex SHA-256 of the bytes. */
  readonly asset: string;
  /** The bytes' media type, such as `audio/wav`, in lowercase. */
  readonly mediaType: string;
  /** The size of the bytes. */
  readonly size: number;
}

/**
 * A source, as a plan document records it: its length, which its clips must
 * lie within, and, once documents travel with their files, its content.
 *
 * @public
 */
export interface AudioPlanDocumentSource {
  /** The source's length in frames, at the plan's sample rate. */
  readonly frames: number;
  readonly asset?: AudioAssetReference;
}

/**
 * The clip plan as portable JSON: `hm-audio-plan` version 1, which
 * `formats/hm-audio-plan/v1.schema.json` describes (docs/formats/hm-audio-plan.md).
 * Every position is a whole number of frames, and sources are named by the
 * ids their clips use.
 *
 * @public
 */
export interface AudioPlanDocument {
  readonly format: typeof AUDIO_PLAN_FORMAT;
  readonly version: typeof AUDIO_PLAN_VERSION;
  readonly sampleRate: number;
  readonly channels: number;
  readonly sources: Readonly<Record<string, AudioPlanDocumentSource>>;
  readonly clips: readonly AudioClip[];
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
 *   document doesn't list; `duplicate-key`, two clips with one key;
 *   `invalid-fade-curve` and `metadata-too-long`, as for commands; and a
 *   clip's own problems, {@link AudioClipProblem}.
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
  | "metadata-too-long";

const DOCUMENT_FIELDS = [
  "format",
  "version",
  "sampleRate",
  "channels",
  "sources",
  "clips",
  "metadata",
];
const SOURCE_FIELDS = ["frames", "asset"];
const ASSET_FIELDS = ["asset", "mediaType", "size"];
const METADATA_FIELDS: readonly (keyof AudioMetadata)[] = [
  "title",
  "artist",
  "album",
  "year",
  "comment",
];
/** The patterns the schema uses too, so both accept the same documents. */
const ASSET_ID = /^sha256:[0-9a-f]{64}$/;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

function malformed(message: string): never {
  return invalid("malformed-command", message);
}

const isCount = (value: unknown, min: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min;

function readAsset(value: unknown): AudioAssetReference {
  if (!isRecord<AudioAssetReference>(value)) malformed("an asset is an object");
  onlyFields(value, ASSET_FIELDS, "an asset");
  const { asset, mediaType, size } = value;
  if (typeof asset !== "string" || !ASSET_ID.test(asset)) malformed("an asset id is sha256:<hex>");
  if (typeof mediaType !== "string" || mediaType.length > 255 || !MEDIA_TYPE.test(mediaType)) {
    malformed("a media type is type/subtype, in lowercase");
  }
  if (!isCount(size, 0)) malformed("an asset's size is a whole number of bytes");
  return { asset, mediaType, size };
}

function readSources(value: unknown): Record<string, AudioPlanDocumentSource> {
  if (!isRecord<Record<string, unknown>>(value) || Array.isArray(value)) {
    malformed("sources is an object");
  }
  return Object.fromEntries(
    Object.entries(value).map(([id, source]) => {
      if (!isKey(id)) malformed("a source id is a non-empty string");
      if (!isRecord<AudioPlanDocumentSource>(source)) malformed("a source is an object");
      onlyFields(source, SOURCE_FIELDS, "a source");
      if (!isCount(source.frames, 1)) malformed("a source's frames are a whole number above 0");
      const entry: AudioPlanDocumentSource =
        source.asset === undefined
          ? { frames: source.frames }
          : { frames: source.frames, asset: readAsset(source.asset) };
      return [id, entry];
    }),
  );
}

function readMetadata(value: unknown): AudioMetadata {
  if (!isRecord<AudioMetadata>(value)) malformed("metadata is an object");
  onlyFields(value, METADATA_FIELDS, "metadata");
  const fields = METADATA_FIELDS.map((field) => {
    const text = value[field];
    if (typeof text !== "string") malformed(`metadata.${field} is text`);
    if (text.length > MAX_METADATA_LENGTH) {
      invalid("metadata-too-long", `metadata.${field} is over ${MAX_METADATA_LENGTH} characters`);
    }
    return [field, text] as const;
  });
  return Object.fromEntries(fields) as unknown as AudioMetadata;
}

function read(value: unknown): {
  plan: AudioPlan;
  sources: Record<string, AudioPlanDocumentSource>;
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
  if (version !== AUDIO_PLAN_VERSION) malformed("version is 1");
  onlyFields(value, DOCUMENT_FIELDS, "a document");
  if (!isCount(value.sampleRate, 1)) malformed("sampleRate is a whole number above 0");
  if (!isCount(value.channels, 1)) malformed("channels is a whole number above 0");
  const sources = readSources(value.sources);
  if (!Array.isArray(value.clips)) malformed("clips is a list");
  const lookup = (id: string) => (Object.hasOwn(sources, id) ? sources[id]?.frames : undefined);
  const clips = value.clips.map((clip: unknown) => checkClip(clip, lookup));
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
 * Reads a plan document, such as one parsed from JSON, checking it as
 * {@link AudioPlanDocument}'s schema does and more: every clip must lie
 * within a source the document lists, and keys must be unique. Unknown
 * fields are refused, never dropped.
 *
 * @param value - The parsed JSON.
 * @returns The plan, and its sources by id.
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
      {
        details: { format: AUDIO_PLAN_FORMAT, reason },
      },
    );
  }
}

/**
 * Writes a plan as an {@link AudioPlanDocument}, plain JSON-ready data.
 *
 * @param plan - The plan.
 * @param sources - The sources by id, with at least every source the plan's
 *   clips use. They're written as given.
 * @throws `TypeError` if a clip's source is missing from `sources`.
 * @public
 */
export function toAudioPlanDocument(
  plan: AudioPlan,
  sources: Readonly<Record<string, AudioPlanDocumentSource>>,
): AudioPlanDocument {
  for (const clip of plan.clips) {
    if (!Object.hasOwn(sources, clip.source)) {
      throw new TypeError(`The sources don't include ${clip.source}, which clip ${clip.key} uses.`);
    }
  }
  return {
    format: AUDIO_PLAN_FORMAT,
    version: AUDIO_PLAN_VERSION,
    sampleRate: plan.sampleRate,
    channels: plan.channels,
    sources: Object.fromEntries(
      Object.entries(sources).map(([id, { frames, asset }]) => [
        id,
        asset === undefined ? { frames } : { frames, asset: { ...asset } },
      ]),
    ),
    clips: plan.clips.map(({ key, source, start, end, gainDb, fadeIn, fadeOut }) => ({
      key,
      source,
      start,
      end,
      gainDb,
      fadeIn: { frames: fadeIn.frames, curve: fadeIn.curve },
      fadeOut: { frames: fadeOut.frames, curve: fadeOut.curve },
    })),
    metadata: { ...plan.metadata },
  };
}
