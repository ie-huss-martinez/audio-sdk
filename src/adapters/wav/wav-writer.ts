import type { AudioMetadata } from "../../core/model/plan.js";
import type { AudioSampleFormat } from "../../core/ports/audio-processor.js";

/**
 * Writes WAV files for export (docs/adr/0001): the header, which the plan
 * fixes in advance, and the samples, block by block.
 *
 * - **Quantisation:** samples are clamped to [−1, 1], and a non-finite one
 *   is silence. 16-bit and 24-bit PCM scale by 2ⁿ⁻¹, round half away from
 *   zero, and clamp to [−2ⁿ⁻¹, 2ⁿ⁻¹ − 1], so +1.0 writes the largest
 *   positive value. Readers that divide by 2ⁿ⁻¹, as this SDK's does, get
 *   back the nearest representable value. There's no dither.
 * - **32-bit float** writes the clamped sample, rounded to the nearest
 *   float32.
 * - **Layout:** `fmt ` is WAVE_FORMAT_EXTENSIBLE, with a speaker mask for
 *   mono, stereo, quad and 5.1, when there are more than two channels or
 *   more than 16 bits; float files also get a `fact` chunk. The metadata
 *   goes in a `LIST`/`INFO` chunk before `data`, and is left out when every
 *   field is empty. A file whose sizes don't fit 32 bits is RF64, with a
 *   `ds64` chunk.
 */

const BYTES: Record<AudioSampleFormat, number> = { pcm16: 2, pcm24: 3, float32: 4 };
const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;
/** The tail every `KSDATAFORMAT_SUBTYPE_*` GUID shares after its format tag. */
const SUBTYPE_TAIL = [
  0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
];
/** Speaker masks for the layouts Web Audio's speaker rules know. */
const SPEAKERS: Readonly<Record<number, number>> = { 1: 0x4, 2: 0x3, 4: 0x33, 6: 0x3f };
const MAX_32 = 0xffffffff;
/** The INFO ids of each metadata field, in the order they're written. */
const INFO_IDS: readonly [keyof AudioMetadata, string][] = [
  ["title", "INAM"],
  ["artist", "IART"],
  ["album", "IPRD"],
  ["year", "ICRD"],
  ["comment", "ICMT"],
];

/** What the header describes. */
export interface WavSpec {
  readonly sampleRate: number;
  readonly channels: number;
  readonly frames: number;
  readonly sampleFormat: AudioSampleFormat;
  readonly metadata: AudioMetadata;
}

/** Bytes per sample of a format. */
export function bytesPerSample(format: AudioSampleFormat): number {
  return BYTES[format];
}

/** The size of the samples, without the pad byte an odd size needs. */
export function dataSize(spec: Pick<WavSpec, "channels" | "frames" | "sampleFormat">): number {
  return spec.frames * spec.channels * BYTES[spec.sampleFormat];
}

class Writer {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly view: DataView;
  at = 0;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  text(value: string): void {
    for (let i = 0; i < value.length; i += 1) this.bytes[this.at + i] = value.charCodeAt(i);
    this.at += value.length;
  }

  u16(value: number): void {
    this.view.setUint16(this.at, value, true);
    this.at += 2;
  }

  u32(value: number): void {
    this.view.setUint32(this.at, value, true);
    this.at += 4;
  }

  u64(value: number): void {
    this.u32(value % 2 ** 32);
    this.u32(Math.floor(value / 2 ** 32));
  }

  raw(value: Uint8Array): void {
    this.bytes.set(value, this.at);
    this.at += value.length;
  }
}

/** The `LIST`/`INFO` chunk's body, or nothing when every field is empty. */
function infoBody(metadata: AudioMetadata): Uint8Array | undefined {
  const encoder = new TextEncoder();
  const fields = INFO_IDS.flatMap(([field, id]) => {
    const text = metadata[field];
    // UTF-8, NUL-terminated, and padded to an even size.
    return text === "" ? [] : [{ id, value: encoder.encode(`${text}\0`) }];
  });
  if (fields.length === 0) return undefined;
  const size =
    4 + fields.reduce((sum, { value }) => sum + 8 + value.length + (value.length % 2), 0);
  const writer = new Writer(size);
  writer.text("INFO");
  for (const { id, value } of fields) {
    writer.text(id);
    writer.u32(value.length);
    writer.raw(value);
    if (value.length % 2 === 1) writer.at += 1;
  }
  return writer.bytes;
}

/**
 * The file's header: everything before the samples. The samples follow
 * directly, and an odd number of sample bytes then needs one pad byte.
 */
export function wavHeader(spec: WavSpec): Uint8Array<ArrayBuffer> {
  const { sampleRate, channels, frames, sampleFormat, metadata } = spec;
  const bytes = BYTES[sampleFormat];
  const float = sampleFormat === "float32";
  const extensible = channels > 2 || bytes > 2;
  const fmtSize = extensible ? 40 : float ? 18 : 16;
  const info = infoBody(metadata);
  const data = dataSize(spec);
  const pad = data % 2;
  const chunks = 8 + fmtSize + (float ? 12 : 0) + (info ? 8 + info.length : 0) + 8 + data + pad;
  const riffSize = 4 + chunks;
  const rf64 = riffSize > MAX_32 || data > MAX_32 || frames > MAX_32;
  const headerSize = 12 + (rf64 ? 36 : 0) + chunks - data - pad;

  const writer = new Writer(headerSize);
  writer.text(rf64 ? "RF64" : "RIFF");
  writer.u32(rf64 ? MAX_32 : riffSize);
  writer.text("WAVE");
  if (rf64) {
    writer.text("ds64");
    writer.u32(28);
    writer.u64(riffSize + 36);
    writer.u64(data);
    writer.u64(frames);
    writer.u32(0);
  }

  writer.text("fmt ");
  writer.u32(fmtSize);
  const tag = float ? WAVE_FORMAT_IEEE_FLOAT : WAVE_FORMAT_PCM;
  writer.u16(extensible ? WAVE_FORMAT_EXTENSIBLE : tag);
  writer.u16(channels);
  writer.u32(sampleRate);
  writer.u32(sampleRate * channels * bytes);
  writer.u16(channels * bytes);
  writer.u16(bytes * 8);
  if (extensible) {
    writer.u16(22);
    writer.u16(bytes * 8);
    writer.u32(SPEAKERS[channels] ?? 0);
    writer.u16(tag);
    for (const byte of SUBTYPE_TAIL) writer.bytes[writer.at++] = byte;
  } else if (float) {
    writer.u16(0);
  }

  if (float) {
    writer.text("fact");
    writer.u32(4);
    writer.u32(rf64 ? MAX_32 : frames);
  }
  if (info) {
    writer.text("LIST");
    writer.u32(info.length);
    writer.raw(info);
  }
  writer.text("data");
  writer.u32(rf64 ? MAX_32 : data);
  return writer.bytes;
}

/** Rounds half away from zero, as the PCM formats document. */
function roundHalfAway(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * A sample as stored: an integer for PCM, a float for float32, after
 * clamping as the module describes.
 */
export function quantise(sample: number, format: AudioSampleFormat): number {
  const clamped = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
  if (format === "float32") return Math.fround(clamped);
  const scale = format === "pcm16" ? 0x8000 : 0x800000;
  // + 0 turns −0 into 0: an integer sample has no sign of zero.
  return Math.min(scale - 1, roundHalfAway(clamped * scale)) + 0;
}

/** Interleaves and quantises one block of samples, one array per channel. */
export function encodeSamples(
  channels: readonly Float32Array[],
  frames: number,
  format: AudioSampleFormat,
): Uint8Array<ArrayBuffer> {
  const bytes = BYTES[format];
  const out = new Uint8Array(frames * channels.length * bytes);
  const view = new DataView(out.buffer);
  let at = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    for (const channel of channels) {
      const value = quantise(channel[frame] ?? 0, format);
      if (format === "float32") view.setFloat32(at, value, true);
      else if (format === "pcm16") view.setInt16(at, value, true);
      else {
        view.setUint8(at, value & 0xff);
        view.setUint8(at + 1, (value >> 8) & 0xff);
        view.setUint8(at + 2, (value >> 16) & 0xff);
      }
      at += bytes;
    }
  }
  return out;
}
