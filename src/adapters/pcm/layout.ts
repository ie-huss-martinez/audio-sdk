import { AudioError } from "../../core/errors/audio-error.js";

/**
 * Where an uncompressed file's samples are and how they're stored: what the
 * probe learns from a WAV or AIFF header, and all the parser needs to read
 * them (docs/adr/0001).
 *
 * @internal
 */
export interface PcmLayout {
  readonly container: "wav" | "aiff";
  readonly sampleRate: number;
  readonly channels: number;
  /** `uint` is 8-bit WAV, which is unsigned. */
  readonly encoding: "int" | "uint" | "float";
  /** Bytes per sample in the file: 1, 2, 3, 4 or 8. */
  readonly bytesPerSample: number;
  readonly littleEndian: boolean;
  /** The byte offset of the first frame. */
  readonly dataOffset: number;
  /** Bytes per frame: channels × bytes per sample. */
  readonly blockAlign: number;
  /** Whole frames in the file. */
  readonly frames: number;
  /**
   * The frames the header declares, when it declares more than the file
   * holds, as in an interrupted recording or download. The file opens with
   * the frames it holds.
   */
  readonly declaredFrames?: number;
}

/** Highest channel count a header may declare before the limits are even consulted. */
const MAX_HEADER_CHANNELS = 1_024;

/**
 * The most chunks a reader walks before giving up. Real files have a few;
 * a file of millions of tiny chunks would only waste time.
 *
 * @internal
 */
export const MAX_CHUNKS = 1_024;

/** @internal */
export function invalid(container: string, reason: string): AudioError {
  return new AudioError("INVALID_AUDIO", `Invalid ${container} file: ${reason}.`, {
    details: { container, reason },
  });
}

/** @internal */
export function unsupported(container: string, codec: string): AudioError {
  return new AudioError(
    "UNSUPPORTED_FORMAT",
    `Unsupported sample format in ${container}: ${codec}.`,
    {
      details: { container, codec },
    },
  );
}

/**
 * Reads up to `length` bytes at `offset`, through the `Blob`, without
 * loading the rest of the file.
 *
 * @internal
 */
export async function readBytes(file: Blob, offset: number, length: number): Promise<DataView> {
  const buffer = await file.slice(offset, offset + length).arrayBuffer();
  return new DataView(buffer);
}

/** A four-character code at `offset`, or "" when the view is too short. */
export function fourCc(view: DataView, offset = 0): string {
  if (view.byteLength < offset + 4) return "";
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/**
 * Checks what every layout must satisfy, whatever the container, and
 * returns it. A layout that passes can be read without any further checks.
 *
 * @internal
 */
export function checkedLayout(layout: PcmLayout): PcmLayout {
  const { container, channels, sampleRate, bytesPerSample, blockAlign, frames, dataOffset } =
    layout;
  if (!Number.isInteger(channels) || channels < 1 || channels > MAX_HEADER_CHANNELS) {
    throw invalid(container, "channel count out of range");
  }
  if (!Number.isInteger(sampleRate) || sampleRate < 1) {
    throw invalid(container, "sample rate out of range");
  }
  if (![1, 2, 3, 4, 8].includes(bytesPerSample)) {
    throw invalid(container, "sample size out of range");
  }
  if (blockAlign !== channels * bytesPerSample) {
    throw invalid(container, "frame size doesn't match the channels and sample size");
  }
  if (!Number.isSafeInteger(frames) || frames < 0 || !Number.isSafeInteger(dataOffset)) {
    throw invalid(container, "length out of range");
  }
  return layout;
}
