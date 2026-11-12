import type { AudioProbe } from "../../core/model/source.js";
import { WindowReader } from "../bytes/window-reader.js";
import { invalid, MAX_CHUNKS } from "../pcm/layout.js";
import {
  type FrameHeader,
  MAX_FRAME_HEADER,
  readFrameHeader,
  readStreamInfo,
  STREAMINFO_LENGTH,
  type StreamInfo,
  skipId3v2,
} from "./flac.js";

/** Bytes walked per step; the window adds room to read a header that starts at its end. */
const STEP = 1 << 20;

/**
 * The most a frame can add to the decoded output, in frames of the stream's
 * own rate and channel count (docs/adr/0001):
 *
 * - **its block size,**
 * - **times the resampling factor** when it declares a lower sample rate than
 *   the stream's, because a decoder that follows the change is resampled to
 *   the stream's rate by the `OfflineAudioContext`;
 * - **times its channel ratio** when it declares more channels than the
 *   stream, so that the decoded size, frames × the stream's channels, still
 *   covers it.
 *
 * Nothing here depends on the frame's CRC-16, which the file controls and
 * which decoders don't check by default.
 *
 * @internal
 */
export function worstCaseFrames(frame: FrameHeader, info: StreamInfo): number {
  const rate =
    frame.sampleRate !== undefined && frame.sampleRate < info.sampleRate
      ? Math.ceil(info.sampleRate / frame.sampleRate)
      : 1;
  const channels = Math.ceil(frame.channels / info.channels);
  return frame.blockSize * rate * channels;
}

/**
 * Probes a native FLAC file (docs/adr/0001). Frames aren't length-prefixed,
 * so the walker searches for frame headers as decoders do: the sync code,
 * valid fields and a matching CRC-8.
 *
 * - **The bound** is the sum, over every header found, of the most that
 *   frame could decode to ({@link worstCaseFrames}). Every candidate counts,
 *   whatever its CRC-16: a crafted frame with a deliberately wrong CRC-16 is
 *   still decoded by decoders that don't check it, which is the default in
 *   ffmpeg. A false sync inside audio data only adds to the bound.
 * - **STREAMINFO's total** is used as the expected length only within the
 *   bound; one that claims more fails.
 *
 * @internal
 */
export async function probeNativeFlac(file: Blob): Promise<AudioProbe> {
  const reader = new WindowReader(file);
  const head = await reader.bytes(0, 10);
  let offset = skipId3v2(head);
  const magic = await reader.bytes(offset, 4);
  if (String.fromCharCode(...magic) !== "fLaC") throw invalid("flac", "missing fLaC marker");
  offset += 4;

  let info: StreamInfo | undefined;
  for (let blocks = 0; ; blocks += 1) {
    if (blocks >= MAX_CHUNKS) throw invalid("flac", "too many metadata blocks");
    const header = await reader.bytes(offset, 4);
    if (header.length < 4) throw invalid("flac", "truncated metadata");
    const last = ((header[0] as number) & 0x80) !== 0;
    const type = (header[0] as number) & 0x7f;
    const length =
      ((header[1] as number) << 16) | ((header[2] as number) << 8) | (header[3] as number);
    if (type === 127) throw invalid("flac", "invalid metadata block type");
    if (blocks === 0) {
      if (type !== 0 || length !== STREAMINFO_LENGTH) {
        throw invalid("flac", "STREAMINFO isn't first");
      }
      info = readStreamInfo(await reader.bytes(offset + 4, STREAMINFO_LENGTH), "flac");
    }
    offset += 4 + length;
    if (offset > reader.size) throw invalid("flac", "metadata exceeds the file");
    if (last) break;
  }
  if (!info) throw invalid("flac", "missing STREAMINFO");

  let bound = 0;
  let frames = 0;
  for (let base = offset; base < reader.size; base += STEP) {
    const bytes = await reader.bytes(base, STEP + MAX_FRAME_HEADER);
    const end = Math.min(STEP, reader.size - base);
    for (let i = 0; i < end; i += 1) {
      if (bytes[i] !== 0xff) continue;
      const header = readFrameHeader(bytes, i);
      if (!header) continue;
      bound += worstCaseFrames(header, info);
      frames += 1;
    }
  }

  if (frames === 0) throw invalid("flac", "no audio frames");
  if (info.totalFrames > bound) {
    throw invalid("flac", "STREAMINFO claims more than the frames carry");
  }
  return {
    container: "flac",
    codec: "flac",
    sampleRate: info.sampleRate,
    channels: info.channels,
    frameBound: bound,
    expectedFrames: info.totalFrames > 0 ? info.totalFrames : bound,
    frameTolerance: info.maxBlockSize,
  };
}
