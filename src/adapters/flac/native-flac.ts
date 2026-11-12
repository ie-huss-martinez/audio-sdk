import type { AudioProbe } from "../../core/model/source.js";
import { crc16Step } from "../bytes/crc.js";
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

/** Bytes walked per step: the window, less room to read a header that starts at its end. */
const STEP = 1 << 20;

/**
 * Frames whose CRC-16 is still open. A false sync inside a frame opens one
 * more; real files rarely have more than two open at once.
 */
const MAX_OPEN_FRAMES = 8;

interface OpenFrame {
  readonly header: FrameHeader;
  readonly start: number;
  /** The CRC-16 after each of the last bytes, newest last. */
  crc: number;
  previous: number;
  beforePrevious: number;
}

/** Checks a frame whose CRC-16 verified: a real frame must agree with STREAMINFO. */
function checkVerified(frame: FrameHeader, info: StreamInfo): void {
  if (frame.channels !== info.channels) {
    throw invalid("flac", "a frame's channel count differs from STREAMINFO");
  }
  if (frame.sampleRate !== undefined && frame.sampleRate !== info.sampleRate) {
    throw invalid("flac", "a frame's sample rate differs from STREAMINFO");
  }
}

/**
 * Probes a native FLAC file (docs/adr/0001). Frames aren't length-prefixed,
 * so the walker searches for frame headers as decoders do: the sync code,
 * valid fields and a matching CRC-8.
 *
 * - **The bound** is the sum of the block sizes of every header found. A
 *   false sync inside audio data can only add to it, which is safe.
 * - **A frame whose CRC-16 also verifies** is certainly real, so it must
 *   agree with STREAMINFO's channels and sample rate; otherwise the file
 *   fails with `INVALID_AUDIO`, because a decoder could output more than the
 *   bound assumes.
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
      if (type !== 0 || length !== STREAMINFO_LENGTH)
        throw invalid("flac", "STREAMINFO isn't first");
      info = readStreamInfo(await reader.bytes(offset + 4, STREAMINFO_LENGTH), "flac");
    }
    offset += 4 + length;
    if (offset > reader.size) throw invalid("flac", "metadata exceeds the file");
    if (last) break;
  }
  if (!info) throw invalid("flac", "missing STREAMINFO");

  let bound = 0;
  let frames = 0;
  let open: OpenFrame[] = [];
  // The two bytes before the current one, which hold a frame's CRC-16 when
  // the next frame starts here.
  let previousByte = 0;
  let lastByte = 0;

  for (let base = offset; base < reader.size; base += STEP) {
    const bytes = await reader.bytes(base, STEP + MAX_FRAME_HEADER);
    const end = Math.min(STEP, reader.size - base);
    for (let i = 0; i < end; i += 1) {
      const byte = bytes[i] as number;
      if (byte === 0xff) {
        const header = readFrameHeader(bytes, i);
        if (header) {
          const position = base + i;
          // A frame that ends here verifies when the CRC-16 of its bytes,
          // up to the two before this header, equals those two bytes.
          const stored = (previousByte << 8) | lastByte;
          const verified = open.findIndex(
            (frame) =>
              position - frame.start >= frame.header.length + 2 && frame.beforePrevious === stored,
          );
          if (verified >= 0) {
            checkVerified((open[verified] as OpenFrame).header, info);
            open = open.slice(verified + 1);
          }
          bound += header.blockSize;
          frames += 1;
          open.push({ header, start: position, crc: 0, previous: 0, beforePrevious: 0 });
          if (open.length > MAX_OPEN_FRAMES) open.shift();
        }
      }
      for (const frame of open) {
        frame.beforePrevious = frame.previous;
        frame.previous = frame.crc;
        frame.crc = crc16Step(frame.crc, byte);
      }
      previousByte = lastByte;
      lastByte = byte;
    }
  }
  // The last frame ends at the end of the file.
  const stored = (previousByte << 8) | lastByte;
  const last = open.find((frame) => frame.beforePrevious === stored);
  if (last) checkVerified(last.header, info);

  if (frames === 0) throw invalid("flac", "no audio frames");
  if (info.totalFrames > bound)
    throw invalid("flac", "STREAMINFO claims more than the frames carry");
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
