import type { AudioProbe } from "../../core/model/source.js";
import { invalid } from "../pcm/layout.js";
import { walkOgg } from "./ogg.js";

const VORBIS = "vorbis";

/** Whether a first Ogg packet is a Vorbis identification header. @internal */
export function isOggVorbis(head: Uint8Array): boolean {
  return head[0] === 0x01 && String.fromCharCode(...head.subarray(1, 7)) === VORBIS;
}

/**
 * Probes Vorbis in Ogg (docs/adr/0001). A Vorbis packet decodes to at most
 * half of `blocksize_1`, which the identification header declares (packet
 * 1; the setup header holds the codebooks and modes, not the block sizes).
 * The bound is that for every audio packet. The identification header is
 * required and checked: an unreadable one fails closed. The last granule
 * position is the expected length only within the bound.
 *
 * @internal
 */
export async function probeOggVorbis(file: Blob): Promise<AudioProbe> {
  let channels = 0;
  let sampleRate = 0;
  let largeBlock = 0;
  let packets = 0;
  let audioPackets = 0;

  const { lastGranule } = await walkOgg(file, ({ head }) => {
    packets += 1;
    if (packets === 1) {
      if (!isOggVorbis(head) || head.length < 30) throw invalid("ogg", "malformed Vorbis header");
      const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
      if (view.getUint32(7, true) !== 0) throw invalid("ogg", "unsupported Vorbis version");
      channels = view.getUint8(11);
      sampleRate = view.getUint32(12, true);
      const sizes = view.getUint8(28);
      const small = sizes & 0xf;
      const large = sizes >> 4;
      // Block sizes are powers of two from 64 to 8,192, the small one no
      // larger, and a framing bit ends the header.
      if (small < 6 || large > 13 || small > large || (view.getUint8(29) & 0x1) !== 1) {
        throw invalid("ogg", "Vorbis block sizes out of range");
      }
      if (channels === 0 || sampleRate === 0) throw invalid("ogg", "Vorbis format out of range");
      largeBlock = 2 ** large;
      return;
    }
    if (packets === 2 || packets === 3) {
      const type = packets === 2 ? 0x03 : 0x05;
      if (head[0] !== type || String.fromCharCode(...head.subarray(1, 7)) !== VORBIS) {
        throw invalid("ogg", "missing Vorbis comment or setup header");
      }
      return;
    }
    audioPackets += 1;
  });

  if (packets < 3) throw invalid("ogg", "missing Vorbis headers");
  if (audioPackets === 0) throw invalid("ogg", "no audio packets");
  const bound = audioPackets * (largeBlock / 2);
  if (lastGranule > bound) throw invalid("ogg", "a declared length exceeds the packets");
  return {
    container: "ogg",
    codec: "vorbis",
    sampleRate,
    channels,
    frameBound: bound,
    expectedFrames: lastGranule > 0 ? lastGranule : bound,
    frameTolerance: largeBlock,
  };
}
