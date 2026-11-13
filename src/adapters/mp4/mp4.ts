import { createWindowReader, type WindowReader } from "@hussmartinez/sdk-core";
import { AudioError } from "../../core/errors/audio-error.js";
import type { AudioProbe } from "../../core/model/source.js";
import {
  type AacConfig,
  aacDecodeRate,
  aacOutputChannels,
  parseAudioSpecificConfig,
} from "../aac/aac-config.js";
import { invalid } from "../pcm/layout.js";

// The walker never recurses: it descends only along fixed paths, such as
// moov › trak › mdia › minf › stbl › stsd › entry › esds, so how deeply a
// file nests its boxes can't make it work harder (docs/adr/0001).
/** The most boxes the walker reads, in all; real files have a few dozen to a few hundred. */
const MAX_BOXES = 100_000;

interface Box {
  readonly type: string;
  /** The offset of its body, after the header. */
  readonly body: number;
  /** The offset just past its end. */
  readonly end: number;
}

function unsupported(reason: string, codec?: string): AudioError {
  return new AudioError("UNSUPPORTED_FORMAT", `Unsupported MP4: ${reason}.`, {
    details:
      codec === undefined ? { container: "mp4", reason } : { container: "mp4", codec, reason },
  });
}

class BoxReader {
  boxes = 0;
  readonly reader: WindowReader;

  constructor(reader: WindowReader) {
    this.reader = reader;
  }

  async u8(at: number): Promise<number> {
    const b = await this.reader.bytes(at, 1);
    if (b.length < 1) throw invalid("mp4", "truncated box");
    return b[0] as number;
  }

  async view(at: number, length: number): Promise<DataView> {
    const b = await this.reader.bytes(at, length);
    if (b.length < length) throw invalid("mp4", "truncated box");
    return new DataView(b.buffer, b.byteOffset, b.byteLength);
  }

  /** The boxes in `[start, end)`, each checked to fit inside it. */
  async children(start: number, end: number, topLevel = false): Promise<Box[]> {
    const boxes: Box[] = [];
    let at = start;
    while (at + 8 <= end) {
      this.boxes += 1;
      if (this.boxes > MAX_BOXES) throw invalid("mp4", "too many boxes");
      const head = await this.view(at, 8);
      let size = head.getUint32(0);
      const type = String.fromCharCode(
        head.getUint8(4),
        head.getUint8(5),
        head.getUint8(6),
        head.getUint8(7),
      );
      let headerSize = 8;
      if (size === 1) {
        const large = await this.view(at + 8, 8);
        const high = large.getUint32(0);
        if (high >= 2 ** 21) throw invalid("mp4", "box size out of range");
        size = high * 2 ** 32 + large.getUint32(4);
        headerSize = 16;
      } else if (size === 0) {
        if (!topLevel) throw invalid("mp4", "open-ended box inside another");
        size = end - at;
      }
      if (size < headerSize || at + size > end) throw invalid("mp4", "box exceeds its parent");
      boxes.push({ type, body: at + headerSize, end: at + size });
      at += size;
    }
    return boxes;
  }

  async child(parent: Box, type: string): Promise<Box | undefined> {
    return (await this.children(parent.body, parent.end)).find((box) => box.type === type);
  }

  async need(parent: Box, type: string): Promise<Box> {
    const box = await this.child(parent, type);
    if (!box) throw invalid("mp4", `missing ${type} box`);
    return box;
  }
}

/** An ES descriptor's length: up to four bytes of seven bits each. */
async function descriptorLength(boxes: BoxReader, at: number): Promise<[number, number]> {
  let length = 0;
  for (let i = 0; i < 4; i += 1) {
    const byte = await boxes.u8(at + i);
    length = length * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return [length, i + 1];
  }
  throw invalid("mp4", "malformed descriptor length");
}

/** Reads the AudioSpecificConfig inside an `esds` box: the core rate and channel configuration. */
async function readEsds(boxes: BoxReader, esds: Box): Promise<AacConfig> {
  // A full box: version and flags, then the ES descriptor.
  let at = esds.body + 4;
  const descriptor = async (tag: number) => {
    if ((await boxes.u8(at)) !== tag) throw unsupported("unexpected ES descriptor");
    const [length, size] = await descriptorLength(boxes, at + 1);
    at += 1 + size;
    if (at + length > esds.end) throw invalid("mp4", "descriptor exceeds its box");
  };
  await descriptor(0x03);
  const flags = await boxes.u8(at + 2);
  at += 3;
  if (flags & 0x80) at += 2; // a stream dependence
  if (flags & 0x40) at += 1 + (await boxes.u8(at)); // a URL
  if (flags & 0x20) at += 2; // an OCR stream
  await descriptor(0x04);
  const objectType = await boxes.u8(at);
  if (![0x40, 0x66, 0x67, 0x68].includes(objectType)) {
    throw unsupported(
      `object type ${objectType}`,
      objectType === 0x6b || objectType === 0x69 ? "mp3" : "unknown",
    );
  }
  at += 13;
  await descriptor(0x05);
  const config = await boxes.reader.bytes(at, Math.min(5, esds.end - at));
  return parseAudioSpecificConfig(config, "mp4");
}

/**
 * Probes an MP4 or M4A file with one audio track of AAC or ALAC
 * (docs/adr/0001).
 *
 * - **The bound** is the number of samples in `stsz` times the most frames a
 *   sample can decode to: for AAC, 1,024 × `ceil(decode rate ÷ core rate)`,
 *   counting every sample as possibly HE-AAC as for ADTS; for ALAC, its
 *   configured frame length.
 * - **Every sample must lie inside the file:** the walker maps samples to
 *   chunks through `stsc`, and checks each one's offset, from `stco` or
 *   `co64`, and size, from `stsz`, against the file's length. The tables
 *   must account for exactly `stsz`'s samples.
 * - **`mdhd`'s duration** is the expected length only within the bound.
 * - **Fragmented files, several audio tracks, and other codecs** fail with
 *   `UNSUPPORTED_FORMAT`, rather than be bounded by a guess.
 *
 * @internal
 */
export async function probeMp4(file: Blob): Promise<AudioProbe> {
  const reader = createWindowReader(file);
  const boxes = new BoxReader(reader);
  const top = await boxes.children(0, reader.size, true);
  if (top.some((box) => box.type === "moof")) throw unsupported("fragmented MP4");
  const moov = top.find((box) => box.type === "moov");
  if (!moov) throw invalid("mp4", "missing moov box");

  const audioTracks: { trak: Box; mdia: Box }[] = [];
  for (const trak of (await boxes.children(moov.body, moov.end)).filter((b) => b.type === "trak")) {
    const mdia = await boxes.child(trak, "mdia");
    const hdlr = mdia && (await boxes.child(mdia, "hdlr"));
    if (!mdia || !hdlr) continue;
    const handler = await boxes.view(hdlr.body + 8, 4);
    if (handler.getUint32(0) === 0x736f756e) audioTracks.push({ trak, mdia }); // "soun"
  }
  if (audioTracks.length === 0) throw invalid("mp4", "no audio track");
  if (audioTracks.length > 1) throw unsupported("several audio tracks");
  const { trak, mdia } = audioTracks[0] as { trak: Box; mdia: Box };

  const mdhd = await boxes.need(mdia, "mdhd");
  const version = await boxes.u8(mdhd.body);
  const times = await boxes.view(mdhd.body + 4, version === 1 ? 28 : 16);
  const timescale = times.getUint32(version === 1 ? 16 : 8);
  const duration =
    version === 1 ? times.getUint32(20) * 2 ** 32 + times.getUint32(24) : times.getUint32(12);
  if (timescale === 0) throw invalid("mp4", "timescale is zero");

  const stbl = await boxes.need(await boxes.need(mdia, "minf"), "stbl");

  // The sample description: one entry, AAC or ALAC.
  const stsd = await boxes.need(stbl, "stsd");
  const [entry] = await boxes.children(stsd.body + 8, stsd.end);
  if (!entry) throw invalid("mp4", "empty sample description");
  const fields = await boxes.view(entry.body, 28);
  const entryVersion = fields.getUint16(8);
  if (entryVersion > 1) throw unsupported("sound sample entry version 2");
  const entryChannels = fields.getUint16(16);
  const entryRate = fields.getUint32(24) >>> 16;
  const childrenStart = entry.body + 28 + (entryVersion === 1 ? 16 : 0);

  let codec: "aac" | "alac";
  let sampleRate: number;
  let channels: number;
  let perSample: number;
  if (entry.type === "mp4a") {
    const esds = (await boxes.children(childrenStart, entry.end)).find((b) => b.type === "esds");
    if (!esds) throw invalid("mp4", "missing esds box");
    const { coreRate, channelConfiguration } = await readEsds(boxes, esds);
    codec = "aac";
    sampleRate = aacDecodeRate(coreRate);
    channels = aacOutputChannels(channelConfiguration || entryChannels);
    perSample = 1_024 * Math.ceil(sampleRate / coreRate);
  } else if (entry.type === "alac") {
    const config = (await boxes.children(childrenStart, entry.end)).find((b) => b.type === "alac");
    if (!config) throw invalid("mp4", "missing ALAC configuration");
    const alac = await boxes.view(config.body + 4, 24);
    codec = "alac";
    perSample = alac.getUint32(0);
    channels = alac.getUint8(9);
    sampleRate = alac.getUint32(20) || entryRate;
    if (perSample === 0 || perSample > 1 << 20)
      throw invalid("mp4", "ALAC frame length out of range");
    if (channels === 0 || sampleRate === 0) throw invalid("mp4", "ALAC format out of range");
  } else {
    throw unsupported(`codec ${entry.type}`, entry.type);
  }

  await checkEditList(boxes, moov, trak, {
    timescale,
    duration,
    decodeRate: sampleRate,
    tolerance: 2 * perSample,
  });

  const samples = await checkSampleLocations(boxes, stbl, reader.size);
  if (samples === 0) throw invalid("mp4", "no audio samples");
  const bound = samples * perSample;
  const expected = duration === 0 ? bound : Math.round((duration * sampleRate) / timescale);
  if (expected > bound) throw invalid("mp4", "the duration claims more than the samples carry");
  return {
    container: "mp4",
    codec,
    sampleRate,
    channels,
    frameBound: bound,
    expectedFrames: expected,
    frameTolerance: 2 * perSample,
  };
}

/**
 * Checks a track's edit list, if it has one (docs/adr/0001). Edit lists can
 * play a media segment several times, or add empty time, and FFmpeg's MP4
 * demuxer, which Chromium decodes through, applies them, so a decoder could
 * output more than the sample tables carry. Only what encoders write is
 * accepted:
 *
 * - at most one empty edit (media time −1), no longer than the tolerance, so
 *   the silence it adds still fits the after-decode check;
 * - then at most one media edit at rate 1, whose media time plus duration
 *   lies within the media's duration.
 *
 * Anything else fails with `UNSUPPORTED_FORMAT`, naming the reason.
 */
async function checkEditList(
  boxes: BoxReader,
  moov: Box,
  trak: Box,
  media: { timescale: number; duration: number; decodeRate: number; tolerance: number },
): Promise<void> {
  const edts = (await boxes.children(trak.body, trak.end)).filter((b) => b.type === "edts");
  if (edts.length === 0) return;
  if (edts.length > 1) throw unsupported("several edit lists");
  const elsts = (await boxes.children((edts[0] as Box).body, (edts[0] as Box).end)).filter(
    (b) => b.type === "elst",
  );
  if (elsts.length === 0) return;
  if (elsts.length > 1) throw unsupported("several edit lists");
  const elst = elsts[0] as Box;

  const mvhd = await boxes.need(moov, "mvhd");
  const movieVersion = await boxes.u8(mvhd.body);
  const movieTimescale = (
    await boxes.view(mvhd.body + (movieVersion === 1 ? 20 : 12), 4)
  ).getUint32(0);
  if (movieTimescale === 0) throw invalid("mp4", "movie timescale is zero");

  const version = await boxes.u8(elst.body);
  const count = (await boxes.view(elst.body + 4, 4)).getUint32(0);
  const entrySize = version === 1 ? 20 : 12;
  if (elst.body + 8 + count * entrySize > elst.end)
    throw invalid("mp4", "edit list exceeds its box");
  if (count > 2) throw unsupported("edit list with more than two edits");

  let sawMedia = false;
  for (let i = 0; i < count; i += 1) {
    const entry = await boxes.view(elst.body + 8 + i * entrySize, entrySize);
    const segment =
      version === 1 ? entry.getUint32(0) * 2 ** 32 + entry.getUint32(4) : entry.getUint32(0);
    const mediaTime =
      version === 1 ? entry.getInt32(8) * 2 ** 32 + entry.getUint32(12) : entry.getInt32(4);
    const rate = entry.getInt16(version === 1 ? 16 : 8);
    const rateFraction = entry.getUint16(version === 1 ? 18 : 10);

    if (mediaTime === -1) {
      if (sawMedia || i > 0) throw unsupported("edit list with an empty edit after another edit");
      const silence = (segment * media.decodeRate) / movieTimescale;
      if (silence > media.tolerance) throw unsupported("edit list with a long empty edit");
      continue;
    }
    if (sawMedia) throw unsupported("edit list with several media edits");
    sawMedia = true;
    if (rate !== 1 || rateFraction !== 0)
      throw unsupported("edit list with a media rate other than 1");
    if (mediaTime < 0 || media.duration === 0) throw unsupported("edit list beyond the media");
    const length = Math.ceil((segment * media.timescale) / movieTimescale);
    if (mediaTime + length > media.duration) throw unsupported("edit list beyond the media");
  }
}

/**
 * Walks the sample tables and checks that every sample lies inside the file.
 * Returns the number of samples.
 */
async function checkSampleLocations(
  boxes: BoxReader,
  stbl: Box,
  fileSize: number,
): Promise<number> {
  const stsz = await boxes.child(stbl, "stsz");
  if (!stsz) {
    if (await boxes.child(stbl, "stz2")) throw unsupported("compact sample sizes");
    throw invalid("mp4", "missing stsz box");
  }
  const sizes = await boxes.view(stsz.body + 4, 8);
  const uniformSize = sizes.getUint32(0);
  const sampleCount = sizes.getUint32(4);
  if (uniformSize === 0 && stsz.body + 12 + sampleCount * 4 > stsz.end) {
    throw invalid("mp4", "stsz table exceeds its box");
  }

  const stsc = await boxes.need(stbl, "stsc");
  const stscCount = (await boxes.view(stsc.body + 4, 4)).getUint32(0);
  if (stsc.body + 8 + stscCount * 12 > stsc.end) throw invalid("mp4", "stsc table exceeds its box");

  const stco = (await boxes.child(stbl, "stco")) ?? (await boxes.child(stbl, "co64"));
  if (!stco) throw invalid("mp4", "missing chunk offsets");
  const wide = stco.type === "co64";
  const chunkCount = (await boxes.view(stco.body + 4, 4)).getUint32(0);
  if (stco.body + 8 + chunkCount * (wide ? 8 : 4) > stco.end) {
    throw invalid("mp4", "chunk offsets exceed their box");
  }

  let sample = 0;
  let entry = 0;
  let samplesPerChunk = 0;
  for (let chunk = 1; chunk <= chunkCount; chunk += 1) {
    // Move to the stsc entry that applies from this chunk on.
    while (entry < stscCount) {
      const next = await boxes.view(stsc.body + 8 + entry * 12, 12);
      if (next.getUint32(0) > chunk) break;
      samplesPerChunk = next.getUint32(4);
      entry += 1;
    }
    const offsetView = await boxes.view(stco.body + 8 + (chunk - 1) * (wide ? 8 : 4), wide ? 8 : 4);
    let offset = wide
      ? offsetView.getUint32(0) * 2 ** 32 + offsetView.getUint32(4)
      : offsetView.getUint32(0);
    for (let i = 0; i < samplesPerChunk; i += 1) {
      if (sample >= sampleCount) throw invalid("mp4", "the sample tables disagree");
      const size =
        uniformSize !== 0
          ? uniformSize
          : (await boxes.view(stsz.body + 12 + sample * 4, 4)).getUint32(0);
      if (offset + size > fileSize) throw invalid("mp4", "a sample lies outside the file");
      offset += size;
      sample += 1;
    }
  }
  if (sample !== sampleCount) throw invalid("mp4", "the sample tables disagree");
  return sampleCount;
}
