import type { AudioProbe } from "../../core/model/source.js";
import { WindowReader } from "../bytes/window-reader.js";
import { invalid } from "../pcm/layout.js";
import { type MpegHeader, readMpegHeader, readStreamTag } from "./mpeg-audio.js";
import { findStream, scanFrames } from "./scan.js";

/** How far past an ID3v2 tag the first frame may start. */
const SEARCH = 64 * 1_024;
const sameStream = (a: MpegHeader, b: MpegHeader) =>
  a.version === b.version && a.layer === b.layer && a.sampleRate === b.sampleRate;

/**
 * Finds an MPEG audio stream at or just after `start`, for the dispatcher.
 *
 * @internal
 */
export async function findMp3(file: Blob, start: number) {
  return findStream(
    new WindowReader(file),
    start,
    SEARCH,
    readMpegHeader,
    (h) => h.frameLength,
    sameStream,
  );
}

/**
 * The most a frame can add to the decoded output, in frames at the stream's
 * rate and channel count: its samples, × the resampling factor when it
 * declares a lower rate, × its channel ratio when it declares more channels.
 */
function worstCase(header: MpegHeader, rate: number, channels: number): number {
  const resample = header.sampleRate < rate ? Math.ceil(rate / header.sampleRate) : 1;
  return header.samplesPerFrame * resample * Math.ceil(header.channels / channels);
}

/**
 * Probes an MPEG audio stream, MP3 in practice (docs/adr/0001). The stream's
 * format comes from its first frames; then every valid frame header in the
 * file counts towards the bound at its worst case, as for native FLAC, so
 * that frames a decoder could find by resyncing are never missed. A Xing,
 * Info or VBRI count is the expected length only within that bound, and a
 * LAME tag's encoder delay and padding join the tolerance.
 *
 * @internal
 */
export async function probeMp3(file: Blob, start: number): Promise<AudioProbe> {
  const reader = new WindowReader(file);
  const found = await findStream(
    reader,
    start,
    SEARCH,
    readMpegHeader,
    (h) => h.frameLength,
    sameStream,
  );
  if (!found) throw invalid("mp3", "no frames");
  const { sampleRate, channels, samplesPerFrame } = found.first;
  const firstFrame = await reader.bytes(found.offset, found.first.frameLength);
  const tag = readStreamTag(firstFrame, found.first);

  let bound = 0;
  let chainFrames = 0;
  await scanFrames(
    reader,
    found.offset,
    4,
    readMpegHeader,
    (h) => h.frameLength,
    (header, inChain) => {
      bound += worstCase(header, sampleRate, channels);
      if (inChain) chainFrames += 1;
    },
  );
  if (bound === 0) throw invalid("mp3", "no frames");

  const delay = tag?.delay ?? 0;
  const padding = tag?.padding ?? 0;
  let expected = chainFrames * samplesPerFrame;
  if (tag?.frames !== undefined) {
    const claimed = tag.frames * samplesPerFrame;
    if (claimed > bound) throw invalid("mp3", "the tag claims more than the frames carry");
    expected = Math.max(0, claimed - delay - padding);
  }
  return {
    container: "mp3",
    codec: "mp3",
    sampleRate,
    channels,
    frameBound: bound,
    expectedFrames: Math.min(expected, bound),
    // Two frames, as ADR 0001 sets for MP3, plus what the encoder declared.
    frameTolerance: 2 * samplesPerFrame + delay + padding,
  };
}
