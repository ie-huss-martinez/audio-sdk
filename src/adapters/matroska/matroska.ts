import { AudioError } from "../../core/errors/audio-error.js";
import type { AudioProbe } from "../../core/model/source.js";
import { aacDecodeRate, aacOutputChannels, parseAudioSpecificConfig } from "../aac/aac-config.js";
import { WindowReader } from "../bytes/window-reader.js";
import { readFrameHeader, readStreamInfo, STREAMINFO_LENGTH } from "../flac/flac.js";
import { MAX_PACKET, OPUS_RATE, opusPacketSamples, readOpusHead } from "../ogg/ogg-opus.js";
import { readVorbisIdentification } from "../ogg/ogg-vorbis.js";
import { invalid } from "../pcm/layout.js";

const EBML = 0x1a45dfa3;
const DOC_TYPE = 0x4282;
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TIMESTAMP_SCALE = 0x2ad7b1;
const DURATION = 0x4489;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const TRACK_NUMBER = 0xd7;
const TRACK_TYPE = 0x83;
const CODEC_ID = 0x86;
const CODEC_PRIVATE = 0x63a2;
const CLUSTER = 0x1f43b675;
const SIMPLE_BLOCK = 0xa3;
const BLOCK_GROUP = 0xa0;
const BLOCK = 0xa1;

/**
 * Elements that belong to the Segment, not to a Cluster. A Cluster of
 * unknown size, as `MediaRecorder` writes, ends at the first of these.
 */
const SEGMENT_LEVEL = new Set([
  CLUSTER,
  0x1c53bb6b, // Cues
  0x1254c367, // Tags
  0x1043a770, // Chapters
  0x1941a469, // Attachments
  0x114d9b74, // SeekHead
  INFO,
  TRACKS,
  EBML,
]);

interface Header {
  readonly id: number;
  /** The offset of the element's data. */
  readonly body: number;
  /** The data's size, or `undefined` when it's unknown. */
  readonly size: number | undefined;
}

function unsupported(reason: string, codec?: string): AudioError {
  return new AudioError("UNSUPPORTED_FORMAT", `Unsupported Matroska: ${reason}.`, {
    details:
      codec === undefined ? { container: "webm", reason } : { container: "webm", codec, reason },
  });
}

/** Reads an element ID (1 to 4 bytes, marker kept) at `at`, or `undefined`. */
function readId(bytes: Uint8Array, at: number): { id: number; length: number } | undefined {
  const first = bytes[at];
  if (first === undefined || first === 0) return undefined;
  const length = Math.clz32(first) - 23;
  if (length > 4 || at + length > bytes.length) return undefined;
  let id = 0;
  for (let i = 0; i < length; i += 1) id = id * 256 + (bytes[at + i] as number);
  return { id, length };
}

/**
 * Reads a variable-length size (1 to 8 bytes, marker removed) at `at`.
 * `unknown` is set when every value bit is 1.
 */
function readSize(
  bytes: Uint8Array,
  at: number,
): { value: number; length: number; unknown: boolean } | undefined {
  const first = bytes[at];
  if (first === undefined || first === 0) return undefined;
  const length = Math.clz32(first) - 23;
  if (at + length > bytes.length) return undefined;
  let value = first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i += 1) {
    const byte = bytes[at + i] as number;
    value = value * 256 + byte;
    if (byte !== 0xff) allOnes = false;
  }
  return { value, length, unknown: allOnes };
}

async function readHeader(reader: WindowReader, at: number): Promise<Header | undefined> {
  const bytes = await reader.bytes(at, 12);
  const id = readId(bytes, 0);
  if (!id) return undefined;
  const size = readSize(bytes, id.length);
  if (!size) return undefined;
  return {
    id: id.id,
    body: at + id.length + size.length,
    size: size.unknown ? undefined : size.value,
  };
}

/** The children of a small, known-size element, read in one go. */
function children(bytes: Uint8Array): { id: number; data: Uint8Array }[] {
  const out: { id: number; data: Uint8Array }[] = [];
  let at = 0;
  while (at < bytes.length) {
    const id = readId(bytes, at);
    const size = id && readSize(bytes, at + id.length);
    if (!id || !size || size.unknown) throw invalid("webm", "malformed element");
    const start = at + id.length + size.length;
    if (start + size.value > bytes.length) throw invalid("webm", "element exceeds its parent");
    out.push({ id: id.id, data: bytes.subarray(start, start + size.value) });
    at = start + size.value;
  }
  return out;
}

const readUint = (data: Uint8Array) => data.reduce((value, byte) => value * 256 + byte, 0);
function readFloat(data: Uint8Array): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length === 4) return view.getFloat32(0);
  if (data.length === 8) return view.getFloat64(0);
  return Number.NaN;
}

/** An audio codec's rules for the bound: how much one frame can decode to. */
interface Codec {
  readonly codec: "opus" | "vorbis" | "flac" | "aac";
  readonly sampleRate: number;
  readonly channels: number;
  readonly tolerance: number;
  /** The most frames one laced frame of the block can decode to. */
  frameSamples(head: Uint8Array, length: number): number;
}

function codecFor(id: string, priv: Uint8Array | undefined): Codec {
  if (id === "A_OPUS") {
    if (!priv) throw invalid("webm", "missing OpusHead");
    const head = readOpusHead(priv, "webm");
    return {
      codec: "opus",
      sampleRate: OPUS_RATE,
      channels: head.channels,
      tolerance: Math.max(MAX_PACKET, head.preSkip),
      frameSamples: opusPacketSamples,
    };
  }
  if (id === "A_VORBIS") {
    // Three headers, Xiph-laced: a count byte, two sizes, then the packets.
    if (priv?.[0] !== 2) throw invalid("webm", "malformed Vorbis headers");
    let at = 1;
    for (let packet = 0; packet < 2; packet += 1) {
      while (priv[at] === 255) at += 1;
      if (priv[at] === undefined) throw invalid("webm", "malformed Vorbis headers");
      at += 1;
    }
    const identification = readVorbisIdentification(priv.subarray(at), "webm");
    const half = identification.largeBlock / 2;
    return {
      codec: "vorbis",
      sampleRate: identification.sampleRate,
      channels: identification.channels,
      tolerance: identification.largeBlock,
      frameSamples: () => half,
    };
  }
  if (id === "A_FLAC") {
    const marker = priv && String.fromCharCode(...priv.subarray(0, 4));
    if (!priv || marker !== "fLaC" || ((priv[4] ?? 0x7f) & 0x7f) !== 0) {
      throw invalid("webm", "missing FLAC STREAMINFO");
    }
    const info = readStreamInfo(priv.subarray(8, 8 + STREAMINFO_LENGTH), "webm");
    return {
      codec: "flac",
      sampleRate: info.sampleRate,
      channels: info.channels,
      tolerance: info.maxBlockSize,
      frameSamples(head) {
        const header = readFrameHeader(head, 0);
        if (!header) return info.maxBlockSize;
        if (header.channels !== info.channels) {
          throw invalid("webm", "a frame's channel count differs from STREAMINFO");
        }
        if (header.sampleRate !== undefined && header.sampleRate !== info.sampleRate) {
          throw invalid("webm", "a frame's sample rate differs from STREAMINFO");
        }
        return header.blockSize;
      },
    };
  }
  if (id.startsWith("A_AAC")) {
    // Without an AudioSpecificConfig, only the Audio element's rate and
    // channel count are known, and for HE-AAC muxers often write the output
    // rate there, not the core rate: a bound from it could be half the
    // decoder's output. Real files carry the config, so others are refused.
    if (!priv) throw unsupported("AAC without an AudioSpecificConfig", "aac");
    const config = parseAudioSpecificConfig(priv, "webm");
    const sampleRate = aacDecodeRate(config.coreRate);
    const perBlock = 1_024 * Math.ceil(sampleRate / config.coreRate);
    return {
      codec: "aac",
      sampleRate,
      channels: aacOutputChannels(config.channelConfiguration),
      tolerance: 2 * perBlock,
      frameSamples: () => perBlock,
    };
  }
  throw unsupported(`codec ${id}`, id);
}

/** The audio track: its number, and its codec's rules. */
interface Track {
  readonly number: number;
  readonly codec: Codec;
}

function readTracks(data: Uint8Array): Track {
  const audio: Track[] = [];
  for (const entry of children(data)) {
    if (entry.id !== TRACK_ENTRY) continue;
    const fields = children(entry.data);
    const field = (id: number) => fields.find((f) => f.id === id)?.data;
    const type = field(TRACK_TYPE);
    if (!type || readUint(type) !== 2) continue;
    const number = field(TRACK_NUMBER);
    const codecId = field(CODEC_ID);
    if (!number || !codecId) throw invalid("webm", "incomplete audio track");
    const id = String.fromCharCode(...codecId).replace(/\0+$/, "");
    audio.push({
      number: readUint(number),
      codec: codecFor(id, field(CODEC_PRIVATE)),
    });
  }
  if (audio.length === 0) throw invalid("webm", "no audio track");
  if (audio.length > 1) throw unsupported("several audio tracks");
  return audio[0] as Track;
}

/**
 * The frames a block of the audio track can decode to, counted per laced
 * frame: none, Xiph, EBML or fixed lacing. Blocks of other tracks, such as
 * video, count nothing.
 */
function countBlock(block: Uint8Array, track: Track): number {
  const number = readSize(block, 0);
  if (!number || number.unknown) throw invalid("webm", "malformed block");
  if (number.value !== track.number) return 0;
  let at = number.length + 2; // the track number, then a 16-bit timestamp
  const flags = block[at];
  if (flags === undefined) throw invalid("webm", "truncated block");
  at += 1;
  const lacing = (flags >> 1) & 0x3;

  const sizes: number[] = [];
  if (lacing === 0) {
    sizes.push(block.length - at);
  } else {
    const countByte = block[at];
    if (countByte === undefined) throw invalid("webm", "truncated block");
    const count = countByte + 1;
    at += 1;
    if (lacing === 1) {
      // Xiph: each size but the last is a run of 255s and a final byte.
      for (let i = 0; i < count - 1; i += 1) {
        let size = 0;
        for (;;) {
          const byte = block[at];
          if (byte === undefined) throw invalid("webm", "truncated lacing");
          at += 1;
          size += byte;
          if (byte < 255) break;
        }
        sizes.push(size);
      }
    } else if (lacing === 3) {
      // EBML: the first size, then signed differences.
      const first = readSize(block, at);
      if (!first || first.unknown) throw invalid("webm", "malformed lacing");
      at += first.length;
      sizes.push(first.value);
      for (let i = 1; i < count - 1; i += 1) {
        const delta = readSize(block, at);
        if (!delta || delta.unknown) throw invalid("webm", "malformed lacing");
        at += delta.length;
        const bias = 2 ** (7 * delta.length - 1) - 1;
        sizes.push((sizes[i - 1] as number) + delta.value - bias);
      }
    }
    const rest = block.length - at;
    if (lacing === 2) {
      if (rest % count !== 0) throw invalid("webm", "fixed lacing doesn't divide the block");
      for (let i = 0; i < count; i += 1) sizes.push(rest / count);
    } else {
      const used = sizes.reduce((sum, size) => sum + size, 0);
      sizes.push(rest - used);
    }
  }
  if (sizes.some((size) => size < 0) || at + sizes.reduce((a, b) => a + b, 0) > block.length) {
    throw invalid("webm", "lacing exceeds the block");
  }

  let total = 0;
  for (const size of sizes) {
    total += track.codec.frameSamples(block.subarray(at, at + Math.min(size, 16)), size);
    at += size;
  }
  return total;
}

/**
 * Probes a Matroska or WebM file with one audio track of Opus, Vorbis, FLAC
 * or AAC (docs/adr/0001).
 *
 * - **One flat walk, no recursion:** the Segment's elements, and each
 *   Cluster's, in order. A Segment or Cluster of unknown size, as
 *   `MediaRecorder` writes, is allowed: a Cluster of unknown size ends at the
 *   next Segment-level element, and the Segment at the end of the file.
 *   Unknown sizes anywhere else, and elements that overrun their parent, are
 *   `INVALID_AUDIO`.
 * - **The bound** is the sum, over every block of the audio track, of each
 *   laced frame's most: Opus from its TOC byte, Vorbis half of
 *   `blocksize_1`, FLAC from its frame header, AAC as possibly HE-AAC from
 *   its AudioSpecificConfig, which must be present.
 * - **The Duration,** when present, is the expected length only within the
 *   bound.
 * - **Several audio tracks, other codecs and other document types** are
 *   `UNSUPPORTED_FORMAT`. Other tracks, such as video, are ignored.
 *
 * @internal
 */
export async function probeMatroska(file: Blob): Promise<AudioProbe> {
  const reader = new WindowReader(file);
  const ebml = await readHeader(reader, 0);
  if (!ebml || ebml.id !== EBML || ebml.size === undefined)
    throw invalid("webm", "missing EBML header");
  const docType = children(await reader.bytes(ebml.body, ebml.size)).find((c) => c.id === DOC_TYPE);
  const type = docType ? String.fromCharCode(...docType.data).replace(/\0+$/, "") : "";
  if (type !== "webm" && type !== "matroska")
    throw unsupported(`document type ${type || "missing"}`);

  const segment = await readHeader(reader, ebml.body + ebml.size);
  if (!segment || segment.id !== SEGMENT) throw invalid("webm", "missing Segment");
  // A Segment that claims more than the file holds ends with the file: only
  // what's there can be decoded.
  const segmentEnd = Math.min(reader.size, segment.body + (segment.size ?? reader.size));

  let track: Track | undefined;
  let timestampScale = 1_000_000;
  let duration: number | undefined;
  let bound = 0;
  let blocks = 0;
  /** The end of the Cluster being walked: a number, `Infinity` when unknown, or `undefined` outside one. */
  let clusterEnd: number | undefined;

  let at = segment.body;
  while (at < segmentEnd) {
    const header = await readHeader(reader, at);
    if (!header) throw invalid("webm", "malformed element");
    if (clusterEnd !== undefined && (at >= clusterEnd || SEGMENT_LEVEL.has(header.id))) {
      clusterEnd = undefined;
    }

    if (clusterEnd === undefined) {
      if (header.id === EBML) throw unsupported("several segments");
      if (header.id === CLUSTER) {
        if (!track) throw invalid("webm", "clusters before the tracks");
        clusterEnd =
          header.size === undefined ? Number.POSITIVE_INFINITY : header.body + header.size;
        if (clusterEnd !== Number.POSITIVE_INFINITY && clusterEnd > segmentEnd) {
          throw invalid("webm", "element exceeds its parent");
        }
        at = header.body;
        continue;
      }
      if (header.size === undefined)
        throw invalid("webm", "unknown size outside a Segment or Cluster");
      const end = header.body + header.size;
      if (end > segmentEnd) throw invalid("webm", "element exceeds its parent");
      if (header.id === INFO) {
        const info = children(await reader.bytes(header.body, header.size));
        const scale = info.find((c) => c.id === TIMESTAMP_SCALE);
        const length = info.find((c) => c.id === DURATION);
        if (scale) timestampScale = readUint(scale.data);
        if (length) duration = readFloat(length.data);
      } else if (header.id === TRACKS) {
        if (track) throw unsupported("several Tracks elements");
        track = readTracks(await reader.bytes(header.body, header.size));
      }
      at = end;
      continue;
    }

    // Inside a Cluster.
    if (header.size === undefined) throw invalid("webm", "unknown size inside a Cluster");
    const end = header.body + header.size;
    if (end > Math.min(clusterEnd, segmentEnd)) throw invalid("webm", "element exceeds its parent");
    const audio = track as Track;
    if (header.id === SIMPLE_BLOCK) {
      bound += countBlock(await reader.bytes(header.body, header.size), audio);
      blocks += 1;
    } else if (header.id === BLOCK_GROUP) {
      for (const child of children(await reader.bytes(header.body, header.size))) {
        if (child.id === BLOCK) {
          bound += countBlock(child.data, audio);
          blocks += 1;
        }
      }
    }
    at = end;
  }

  if (!track) throw invalid("webm", "missing Tracks");
  if (blocks === 0 || bound === 0) throw invalid("webm", "no audio blocks");
  const { codec } = track;
  let expected = bound;
  if (duration !== undefined) {
    if (!Number.isFinite(duration) || duration < 0) throw invalid("webm", "Duration out of range");
    expected = Math.round(((duration * timestampScale) / 1e9) * codec.sampleRate);
    if (expected > bound) throw invalid("webm", "the Duration claims more than the blocks carry");
  }
  return {
    container: "webm",
    codec: codec.codec,
    sampleRate: codec.sampleRate,
    channels: codec.channels,
    frameBound: bound,
    expectedFrames: expected,
    frameTolerance: codec.tolerance,
  };
}
