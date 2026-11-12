import { AudioError } from "../../core/errors/audio-error.js";
import { WindowReader } from "../bytes/window-reader.js";
import { invalid } from "../pcm/layout.js";

/** The fixed part of a page header, before its segment table. */
const PAGE_HEADER = 27;
/** The most a page can be: the header, 255 lacing values, and 255 × 255 bytes. */
const MAX_PAGE = PAGE_HEADER + 255 + 255 * 255;
/** How many bytes of each packet's start the walker keeps, for codec headers. */
export const PACKET_HEAD = 64;
/** An absent granule position: no packet ends on the page. */
const NO_GRANULE = -1;

/** A packet, as the walker reports it: its first bytes and its length. @internal */
export interface OggPacket {
  /** Up to {@link PACKET_HEAD} bytes from the packet's start. */
  readonly head: Uint8Array;
  readonly length: number;
}

/** What the walker learned about the stream besides its packets. @internal */
export interface OggStream {
  /** The last granule position of a complete page, or -1. */
  readonly lastGranule: number;
}

/**
 * Walks the pages of an Ogg file and reports each complete packet of its
 * first logical stream, in order (docs/adr/0001). The walk is linear: a page
 * is at most 65,307 bytes, and between pages the walker searches for the
 * next capture pattern, as decoders do.
 *
 * - **Pages of other streams** are ignored. A file that starts a second
 *   stream (multiplexed Ogg) fails with `UNSUPPORTED_FORMAT`.
 * - **Page CRCs aren't required to match.** A decoder drops a damaged page,
 *   so counting its packets anyway only raises the bound, which is safe.
 * - **An incomplete page at the end** carries no packet a decoder could use,
 *   and is ignored.
 *
 * @throws `INVALID_AUDIO` when the file doesn't start with a page.
 * @internal
 */
export async function walkOgg(
  file: Blob,
  onPacket: (packet: OggPacket) => void,
): Promise<OggStream> {
  const reader = new WindowReader(file);
  let serial: number | undefined;
  let lastGranule = NO_GRANULE;
  // The packet being assembled across segments, and pages.
  let head: number[] = [];
  let length = 0;
  let offset = 0;
  let pages = 0;

  while (offset + PAGE_HEADER <= reader.size) {
    const bytes = await reader.bytes(offset, MAX_PAGE);
    if (bytes[0] !== 0x4f || bytes[1] !== 0x67 || bytes[2] !== 0x67 || bytes[3] !== 0x53) {
      if (pages === 0) throw invalid("ogg", "missing first page");
      offset += 1;
      continue;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint8(4);
    const type = view.getUint8(5);
    const segments = view.getUint8(26);
    if (version !== 0 || bytes.length < PAGE_HEADER + segments) {
      if (pages === 0) throw invalid("ogg", "malformed first page");
      offset += 1;
      continue;
    }
    let body = 0;
    for (let s = 0; s < segments; s += 1) body += bytes[PAGE_HEADER + s] as number;
    const pageLength = PAGE_HEADER + segments + body;
    if (pageLength > bytes.length) break; // An incomplete last page.

    const pageSerial = view.getUint32(14, true);
    const beginsStream = (type & 0x02) !== 0;
    if (serial === undefined) {
      if (!beginsStream) throw invalid("ogg", "first page doesn't begin a stream");
      serial = pageSerial;
    } else if (pageSerial !== serial) {
      if (beginsStream) {
        throw new AudioError(
          "UNSUPPORTED_FORMAT",
          "Ogg files with several streams aren't supported.",
          { details: { container: "ogg", reason: "multiplexed streams" } },
        );
      }
      offset += pageLength;
      pages += 1;
      continue;
    }

    // A page that doesn't continue a packet drops one left unfinished.
    if ((type & 0x01) === 0) {
      head = [];
      length = 0;
    }
    let position = PAGE_HEADER + segments;
    for (let s = 0; s < segments; s += 1) {
      const lacing = bytes[PAGE_HEADER + s] as number;
      if (head.length < PACKET_HEAD) {
        const take = Math.min(lacing, PACKET_HEAD - head.length);
        for (let i = 0; i < take; i += 1) head.push(bytes[position + i] as number);
      }
      length += lacing;
      position += lacing;
      if (lacing < 255) {
        onPacket({ head: Uint8Array.from(head), length });
        head = [];
        length = 0;
      }
    }
    const granuleHigh = view.getInt32(10, true);
    const granuleLow = view.getUint32(6, true);
    if (!(granuleHigh === -1 && granuleLow === 0xffffffff)) {
      lastGranule = granuleHigh * 2 ** 32 + granuleLow;
    }
    offset += pageLength;
    pages += 1;
  }
  if (pages === 0) throw invalid("ogg", "missing first page");
  return { lastGranule };
}
