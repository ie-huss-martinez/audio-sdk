import type { WindowReader } from "../bytes/window-reader.js";

/** Bytes scanned per step; the window adds room to read a header that starts at its end. */
const STEP = 1 << 20;

/**
 * Scans a stream for frame headers, byte by byte from `start`, as decoders
 * search for their sync (docs/adr/0001). It calls `onFrame` for every
 * position with a valid header, and says whether that header continues the
 * chain of frames from the first one, each starting where the last ended,
 * or sits inside another frame's data.
 *
 * Callers count every header towards the bound, so a false sync can only
 * raise it, and use the chain for the expected length.
 *
 * @internal
 */
export async function scanFrames<Header>(
  reader: WindowReader,
  start: number,
  maxHeaderLength: number,
  readHeader: (bytes: Uint8Array, offset: number) => Header | undefined,
  frameLength: (header: Header) => number,
  onFrame: (header: Header, inChain: boolean) => void,
): Promise<void> {
  let nextInChain = start;
  for (let base = start; base < reader.size; base += STEP) {
    const bytes = await reader.bytes(base, STEP + maxHeaderLength);
    const end = Math.min(STEP, reader.size - base);
    for (let i = 0; i < end; i += 1) {
      if (bytes[i] !== 0xff) continue;
      const header = readHeader(bytes, i);
      if (header === undefined) continue;
      const position = base + i;
      // A header past where the chain expected one restarts the chain, as a
      // decoder that lost sync would.
      const inChain = position >= nextInChain;
      if (inChain) nextInChain = position + Math.max(1, frameLength(header));
      onFrame(header, inChain);
    }
  }
}

/**
 * Finds where a stream's frames begin: the first position, within the first
 * `window` bytes after `start`, where `count` valid headers follow each other
 * exactly and agree on `same`. That's how the probe tells a stream from
 * bytes that merely look like a header.
 *
 * @internal
 */
export async function findStream<Header>(
  reader: WindowReader,
  start: number,
  window: number,
  readHeader: (bytes: Uint8Array, offset: number) => Header | undefined,
  frameLength: (header: Header) => number,
  same: (a: Header, b: Header) => boolean,
  count = 3,
): Promise<{ readonly offset: number; readonly first: Header } | undefined> {
  const bytes = await reader.bytes(start, window + 64 * 1_024);
  for (let i = 0; i < Math.min(window, bytes.length); i += 1) {
    if (bytes[i] !== 0xff) continue;
    const first = readHeader(bytes, i);
    if (first === undefined) continue;
    let at = i;
    let header = first;
    for (let found = 1; ; found += 1) {
      if (found === count) return { offset: start + i, first };
      const next = at + frameLength(header);
      // A stream shorter than `count` frames still counts if it ends
      // exactly at the end of the file.
      if (next === bytes.length && start + bytes.length === reader.size) {
        return { offset: start + i, first };
      }
      const following = readHeader(bytes, next);
      if (following === undefined || !same(first, following)) break;
      at = next;
      header = following;
    }
  }
  return undefined;
}
