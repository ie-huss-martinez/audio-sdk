import { crc8 } from "../bytes/crc.js";
import { invalid } from "../pcm/layout.js";

/** What a FLAC stream's `STREAMINFO` block declares. @internal */
export interface StreamInfo {
  readonly minBlockSize: number;
  readonly maxBlockSize: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitsPerSample: number;
  /** The declared length in frames; 0 means unknown. Never trusted as a bound (docs/adr/0001). */
  readonly totalFrames: number;
}

/** The size of a `STREAMINFO` block's body. @internal */
export const STREAMINFO_LENGTH = 34;

/**
 * Reads a `STREAMINFO` body.
 *
 * @throws `INVALID_AUDIO` for impossible values.
 * @internal
 */
export function readStreamInfo(bytes: Uint8Array, container: string): StreamInfo {
  if (bytes.length < STREAMINFO_LENGTH) throw invalid(container, "truncated STREAMINFO");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minBlockSize = view.getUint16(0);
  const maxBlockSize = view.getUint16(2);
  // 20 bits of sample rate, 3 of channels minus one, 5 of bits per sample
  // minus one, then 36 bits of total samples.
  const packed = view.getUint32(10);
  const sampleRate = packed >>> 12;
  const channels = ((packed >>> 9) & 0x7) + 1;
  const bitsPerSample = ((packed >>> 4) & 0x1f) + 1;
  const totalFrames = (packed & 0xf) * 2 ** 32 + view.getUint32(14);
  if (minBlockSize < 16 || maxBlockSize < minBlockSize) {
    throw invalid(container, "block sizes out of range");
  }
  if (sampleRate === 0) throw invalid(container, "sample rate is zero");
  if (bitsPerSample < 4) throw invalid(container, "sample size out of range");
  return { minBlockSize, maxBlockSize, sampleRate, channels, bitsPerSample, totalFrames };
}

/** A frame header the walker recognised: what it says, and how long it is. @internal */
export interface FrameHeader {
  /** Frames (inter-channel samples) in this FLAC frame. */
  readonly blockSize: number;
  /** The sample rate it declares, or `undefined` for "as in STREAMINFO". */
  readonly sampleRate: number | undefined;
  readonly channels: number;
  /** The header's length in bytes, including its CRC-8. */
  readonly length: number;
}

/** The longest a frame header can be: sync to CRC-8. @internal */
export const MAX_FRAME_HEADER = 16;

const SAMPLE_RATES = [
  undefined,
  88_200,
  176_400,
  192_000,
  8_000,
  16_000,
  22_050,
  24_000,
  32_000,
  44_100,
  48_000,
  96_000,
];

/**
 * Reads a FLAC frame header at `offset`, if there is a valid one: the sync
 * code, no reserved values, a well-formed coded number, and a matching
 * CRC-8. Returns `undefined` otherwise, without throwing, because native
 * FLAC is walked by searching for headers, as decoders do.
 *
 * @internal
 */
export function readFrameHeader(bytes: Uint8Array, offset: number): FrameHeader | undefined {
  const at = (index: number): number | undefined => bytes[offset + index];
  // Sync: 0b11111111_1111100x.
  if (at(0) !== 0xff || ((at(1) ?? 0) & 0xfe) !== 0xf8) return undefined;
  const b2 = at(2);
  const b3 = at(3);
  if (b2 === undefined || b3 === undefined) return undefined;
  const blockCode = b2 >> 4;
  const rateCode = b2 & 0xf;
  const channelCode = b3 >> 4;
  const sizeCode = (b3 >> 1) & 0x7;
  if (blockCode === 0 || rateCode === 15 || channelCode > 10 || sizeCode === 3 || b3 & 1) {
    return undefined;
  }

  // The frame or sample number, coded like UTF-8, in 1 to 7 bytes.
  let index = 4;
  const lead = at(index);
  if (lead === undefined) return undefined;
  let extra: number;
  if (lead < 0x80) extra = 0;
  else if (lead >= 0xc0 && lead < 0xe0) extra = 1;
  else if (lead >= 0xe0 && lead < 0xf0) extra = 2;
  else if (lead >= 0xf0 && lead < 0xf8) extra = 3;
  else if (lead >= 0xf8 && lead < 0xfc) extra = 4;
  else if (lead >= 0xfc && lead < 0xfe) extra = 5;
  else if (lead === 0xfe) extra = 6;
  else return undefined;
  index += 1;
  for (let i = 0; i < extra; i += 1, index += 1) {
    const byte = at(index);
    if (byte === undefined || (byte & 0xc0) !== 0x80) return undefined;
  }

  let blockSize: number;
  if (blockCode === 1) blockSize = 192;
  else if (blockCode <= 5) blockSize = 576 * 2 ** (blockCode - 2);
  else if (blockCode === 6 || blockCode === 7) {
    const high = at(index);
    if (high === undefined) return undefined;
    if (blockCode === 6) {
      blockSize = high + 1;
      index += 1;
    } else {
      const low = at(index + 1);
      if (low === undefined) return undefined;
      blockSize = high * 256 + low + 1;
      index += 2;
    }
  } else blockSize = 256 * 2 ** (blockCode - 8);

  let sampleRate: number | undefined = SAMPLE_RATES[rateCode];
  if (rateCode >= 12) {
    const high = at(index);
    if (high === undefined) return undefined;
    if (rateCode === 12) {
      sampleRate = high * 1_000;
      index += 1;
    } else {
      const low = at(index + 1);
      if (low === undefined) return undefined;
      sampleRate = rateCode === 13 ? high * 256 + low : (high * 256 + low) * 10;
      index += 2;
    }
    if (sampleRate === 0) return undefined;
  }

  const crc = at(index);
  if (crc === undefined || crc8(bytes, offset, offset + index) !== crc) return undefined;
  return {
    blockSize,
    sampleRate,
    channels: channelCode < 8 ? channelCode + 1 : 2,
    length: index + 1,
  };
}

/**
 * Skips an ID3v2 tag at the start of a file, which some FLAC and MP3 files
 * have, and returns the offset after it, or 0 when there's none.
 *
 * @internal
 */
export function skipId3v2(bytes: Uint8Array): number {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  let size = 0;
  for (let i = 6; i < 10; i += 1) {
    const byte = bytes[i] as number;
    if (byte & 0x80) return 0;
    size = size * 128 + byte;
  }
  const footer = (bytes[5] as number) & 0x10 ? 10 : 0;
  return 10 + size + footer;
}
