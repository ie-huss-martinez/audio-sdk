import type { AudioMetadata } from "../model/plan.js";
import {
  invalid,
  isKey,
  isRecord,
  longerThan,
  MAX_METADATA_LENGTH,
  onlyFields,
} from "../operations/checks.js";

/**
 * The parts every version of a plan document has (sdk-core ADR 0045): the
 * format's name, sources with their assets, and the metadata.
 */

/**
 * The name of the clip plan's portable format (sdk-core ADR 0045).
 *
 * @public
 */
export const AUDIO_PLAN_FORMAT = "hm-audio-plan";

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

/** @internal */
export function malformed(message: string): never {
  return invalid("malformed-command", message);
}

/** @internal */
export const isCount = (value: unknown, min: number): value is number =>
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

/** @internal */
export function readSources(value: unknown): Record<string, AudioPlanDocumentSource> {
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

/** @internal */
export function readMetadata(value: unknown): AudioMetadata {
  if (!isRecord<AudioMetadata>(value)) malformed("metadata is an object");
  onlyFields(value, METADATA_FIELDS, "metadata");
  const fields = METADATA_FIELDS.map((field) => {
    const text = value[field];
    if (typeof text !== "string") malformed(`metadata.${field} is text`);
    if (longerThan(text, MAX_METADATA_LENGTH)) {
      invalid("metadata-too-long", `metadata.${field} is over ${MAX_METADATA_LENGTH} code points`);
    }
    return [field, text] as const;
  });
  return Object.fromEntries(fields) as unknown as AudioMetadata;
}
