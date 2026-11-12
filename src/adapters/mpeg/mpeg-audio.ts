/**
 * MPEG audio frame headers (MPEG-1, MPEG-2 and MPEG-2.5, layers I to III),
 * and the Xing, Info, LAME and VBRI tags in a stream's first frame.
 */

/** A frame header the walker recognised. @internal */
export interface MpegHeader {
  /** 1 for MPEG-1, 2 for MPEG-2, 2.5 for MPEG-2.5. */
  readonly version: 1 | 2 | 2.5;
  readonly layer: 1 | 2 | 3;
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  /** Samples per channel the frame decodes to. */
  readonly samplesPerFrame: number;
  /** The frame's length in bytes, header included. */
  readonly frameLength: number;
  /** Whether a 16-bit CRC follows the header. */
  readonly protected: boolean;
}

const RATES: Record<number, readonly number[]> = {
  1: [44_100, 48_000, 32_000],
  2: [22_050, 24_000, 16_000],
  2.5: [11_025, 12_000, 8_000],
};

/** Bitrates in kbit/s, by version group and layer; index 0 (free format) and 15 are invalid. */
const BITRATES: Record<string, readonly number[]> = {
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

/**
 * Reads an MPEG audio frame header at `offset`, if there's a valid one: the
 * 11-bit sync, and no reserved version, layer, bitrate, sample rate or
 * emphasis. Free-format frames (bitrate index 0) aren't recognised, as
 * ADR 0001 says. Returns `undefined` otherwise, without throwing.
 *
 * @internal
 */
export function readMpegHeader(bytes: Uint8Array, offset: number): MpegHeader | undefined {
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const b3 = bytes[offset + 3];
  if (b0 !== 0xff || b1 === undefined || b2 === undefined || b3 === undefined) return undefined;
  if ((b1 & 0xe0) !== 0xe0) return undefined;
  const versionBits = (b1 >> 3) & 0x3;
  const layerBits = (b1 >> 1) & 0x3;
  const bitrateIndex = b2 >> 4;
  const rateIndex = (b2 >> 2) & 0x3;
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15) {
    return undefined;
  }
  if (rateIndex === 3 || (b3 & 0x3) === 2) return undefined;

  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
  const layer = (4 - layerBits) as 1 | 2 | 3;
  const sampleRate = RATES[version]?.[rateIndex] as number;
  const bitrate = (BITRATES[`${version === 1 ? 1 : 2}-${layer}`]?.[bitrateIndex] as number) * 1_000;
  const padding = (b2 >> 1) & 0x1;
  const channels = b3 >> 6 === 3 ? 1 : 2;

  let samplesPerFrame: number;
  let frameLength: number;
  if (layer === 1) {
    samplesPerFrame = 384;
    frameLength = (Math.floor((12 * bitrate) / sampleRate) + padding) * 4;
  } else if (layer === 2 || version === 1) {
    samplesPerFrame = 1_152;
    frameLength = Math.floor((144 * bitrate) / sampleRate) + padding;
  } else {
    samplesPerFrame = 576;
    frameLength = Math.floor((72 * bitrate) / sampleRate) + padding;
  }
  if (frameLength < 4) return undefined;
  return {
    version,
    layer,
    sampleRate,
    channels,
    samplesPerFrame,
    frameLength,
    protected: (b1 & 0x1) === 0,
  };
}

/** What a stream's first frame says about the whole stream, if it carries a tag. @internal */
export interface StreamTag {
  /** Frames in the stream, by the tag's count, not counting the tag's own frame. */
  readonly frames?: number;
  /** Samples of encoder delay at the start, from a LAME or VBRI tag. */
  readonly delay?: number;
  /** Samples of padding at the end, from a LAME tag. */
  readonly padding?: number;
}

/**
 * Reads a Xing or Info tag (with LAME's extension) or a VBRI tag from a
 * stream's first frame, when it has one. The counts are claims: the walker
 * uses them only within the bound it walked (docs/adr/0001).
 *
 * @internal
 */
export function readStreamTag(frame: Uint8Array, header: MpegHeader): StreamTag | undefined {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const text = (at: number) =>
    at + 4 <= frame.length ? String.fromCharCode(...frame.subarray(at, at + 4)) : "";

  // Xing and Info follow the side information, whose size depends on the
  // version and channel count.
  const sideInfo =
    header.version === 1 ? (header.channels === 1 ? 17 : 32) : header.channels === 1 ? 9 : 17;
  let at = 4 + (header.protected ? 2 : 0) + sideInfo;
  const tag = text(at);
  if (tag === "Xing" || tag === "Info") {
    if (at + 8 > frame.length) return undefined;
    const flags = view.getUint32(at + 4);
    at += 8;
    let frames: number | undefined;
    if (flags & 0x1) {
      if (at + 4 > frame.length) return undefined;
      frames = view.getUint32(at);
      at += 4;
    }
    if (flags & 0x2) at += 4;
    if (flags & 0x4) at += 100;
    if (flags & 0x8) at += 4;
    // LAME's extension: 21 bytes in, 12 bits of delay and 12 of padding.
    if (at + 24 <= frame.length && text(at) === "LAME") {
      const packed =
        (frame[at + 21] as number) * 65_536 +
        (frame[at + 22] as number) * 256 +
        (frame[at + 23] as number);
      return {
        ...(frames === undefined ? {} : { frames }),
        delay: packed >> 12,
        padding: packed & 0xfff,
      };
    }
    return frames === undefined ? {} : { frames };
  }
  if (text(36) === "VBRI" && 36 + 18 <= frame.length) {
    return { delay: view.getUint16(36 + 6), frames: view.getUint32(36 + 14) };
  }
  return undefined;
}
