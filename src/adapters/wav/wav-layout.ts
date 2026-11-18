import type { AudioMetadata } from "../../core/model/plan.js";
import type { AudioSampleFormat } from "../../core/ports/audio-processor.js";
import { bytesPerSample, dataSize } from "./wav-data.js";

export { bytesPerSample, dataSize } from "./wav-data.js";

/**
 * A WAV file's layout, without writing it (docs/adr/0001): what the writer
 * builds its header from, and what an editor shows as an export's size
 * before anything is rendered. Apart from the writer, so a page can know a
 * file's size without loading the code that writes one.
 */

/** What a file's header describes. */
export interface WavSpec {
  readonly sampleRate: number;
  readonly channels: number;
  readonly frames: number;
  readonly sampleFormat: AudioSampleFormat;
  readonly metadata: AudioMetadata;
}

const MAX_32 = 0xffffffff;

/** The INFO ids of each metadata field, in the order they're written. */
export const INFO_IDS: readonly [keyof AudioMetadata, string][] = [
  ["title", "INAM"],
  ["artist", "IART"],
  ["album", "IPRD"],
  ["year", "ICRD"],
  ["comment", "ICMT"],
];

/** Each metadata field the `LIST`/`INFO` chunk carries: UTF-8, NUL-terminated. */
export function infoFields(metadata: AudioMetadata): { id: string; value: Uint8Array }[] {
  const encoder = new TextEncoder();
  return INFO_IDS.flatMap(([field, id]) => {
    const text = metadata[field];
    return text === "" ? [] : [{ id, value: encoder.encode(`${text}\0`) }];
  });
}

/** The `LIST`/`INFO` chunk's body size, each field padded to an even size, or 0 without one. */
export function infoSize(fields: readonly { readonly value: Uint8Array }[]): number {
  if (fields.length === 0) return 0;
  return 4 + fields.reduce((sum, { value }) => sum + 8 + value.length + (value.length % 2), 0);
}

/** Where everything in a file goes, and how big it is. */
export interface WavLayout {
  readonly bytes: number;
  readonly float: boolean;
  readonly extensible: boolean;
  readonly fmtSize: number;
  /** The `LIST`/`INFO` chunk's body size, or 0 when every field is empty. */
  readonly infoSize: number;
  readonly data: number;
  readonly pad: number;
  readonly riffSize: number;
  /** Whether it's RF64, for a file past 4 GiB. */
  readonly rf64: boolean;
  /** Everything before the samples. */
  readonly headerSize: number;
  /** The whole file: the header, the samples and their pad byte. */
  readonly fileSize: number;
}

/** A file's layout, for its spec and its metadata's INFO fields. */
export function wavLayout(
  spec: WavSpec,
  fields: readonly { readonly value: Uint8Array }[] = infoFields(spec.metadata),
): WavLayout {
  const { channels, frames, sampleFormat } = spec;
  const bytes = bytesPerSample(sampleFormat);
  const float = sampleFormat === "float32";
  const extensible = channels > 2 || bytes > 2;
  const fmtSize = extensible ? 40 : float ? 18 : 16;
  const info = infoSize(fields);
  const data = dataSize(spec);
  const pad = data % 2;
  const chunks = 8 + fmtSize + (float ? 12 : 0) + (info ? 8 + info : 0) + 8 + data + pad;
  const riffSize = 4 + chunks;
  const rf64 = riffSize > MAX_32 || data > MAX_32 || frames > MAX_32;
  const fileSize = 12 + (rf64 ? 36 : 0) + chunks;
  return {
    bytes,
    float,
    extensible,
    fmtSize,
    infoSize: info,
    data,
    pad,
    riffSize,
    rf64,
    headerSize: fileSize - data - pad,
    fileSize,
  };
}

/** The whole file's size in bytes: its header, its samples and their pad byte. */
export function wavFileSize(spec: WavSpec): number {
  return wavLayout(spec).fileSize;
}
