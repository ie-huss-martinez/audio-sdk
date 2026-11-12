import { AudioError } from "../../core/errors/audio-error.js";
import type { AudioProbe } from "../../core/model/source.js";
import { invalid } from "../pcm/layout.js";
import { walkOgg } from "./ogg.js";

/** Opus always decodes at 48 kHz, whatever rate its header records (RFC 7845). */
const OPUS_RATE = 48_000;
/** The longest an Opus packet can decode to: 120 ms at 48 kHz (RFC 6716). */
const MAX_PACKET = 5_760;

/** Whether a first Ogg packet is an Opus identification header. @internal */
export function isOggOpus(head: Uint8Array): boolean {
  return String.fromCharCode(...head.subarray(0, 8)) === "OpusHead";
}

/** A frame's duration in 48 kHz samples, from a TOC byte's configuration (RFC 6716, 3.1). */
function frameSamples(config: number): number {
  if (config < 12) return [480, 960, 1_920, 2_880][config % 4] as number; // SILK: 10–60 ms
  if (config < 16) return [480, 960][config % 2] as number; // hybrid: 10–20 ms
  return [120, 240, 480, 960][config % 4] as number; // CELT: 2.5–20 ms
}

/**
 * The samples an Opus packet decodes to, from its TOC byte and, for code 3,
 * its frame count. A packet that can't be read this way counts as the most
 * any packet can be, 120 ms, which only raises the bound.
 *
 * @internal
 */
export function opusPacketSamples(head: Uint8Array, length: number): number {
  const toc = head[0];
  if (length === 0 || toc === undefined) return MAX_PACKET;
  const perFrame = frameSamples(toc >> 3);
  const code = toc & 0x3;
  let frames: number;
  if (code === 0) frames = 1;
  else if (code === 1 || code === 2) frames = 2;
  else {
    const count = head[1];
    if (count === undefined) return MAX_PACKET;
    frames = count & 0x3f;
  }
  const samples = frames * perFrame;
  return samples === 0 || samples > MAX_PACKET ? MAX_PACKET : samples;
}

/**
 * Probes Opus in Ogg (docs/adr/0001). Opus decodes at 48 kHz. The bound is
 * the sum of every audio packet's samples, read from its TOC byte, so it's
 * exact. The last granule position, which counts the pre-skip, is the
 * expected length less the pre-skip, only within the bound.
 *
 * @internal
 */
export async function probeOggOpus(file: Blob): Promise<AudioProbe> {
  let channels = 0;
  let preSkip = 0;
  let packets = 0;
  let bound = 0;

  const { lastGranule } = await walkOgg(file, ({ head, length }) => {
    packets += 1;
    if (packets === 1) {
      if (!isOggOpus(head) || head.length < 19) throw invalid("ogg", "malformed OpusHead");
      if (((head[8] as number) & 0xf0) !== 0) throw invalid("ogg", "unsupported OpusHead version");
      channels = head[9] as number;
      preSkip = (head[10] as number) | ((head[11] as number) << 8);
      const family = head[18] as number;
      if (channels === 0) throw invalid("ogg", "no channels");
      if (family === 0 ? channels > 2 : family !== 1 || channels > 8) {
        throw new AudioError("UNSUPPORTED_FORMAT", "Unsupported Opus channel mapping.", {
          details: { container: "ogg", codec: "opus", reason: `channel mapping family ${family}` },
        });
      }
      return;
    }
    if (packets === 2) {
      if (String.fromCharCode(...head.subarray(0, 8)) !== "OpusTags") {
        throw invalid("ogg", "missing OpusTags");
      }
      return;
    }
    bound += opusPacketSamples(head, length);
  });

  if (packets < 2) throw invalid("ogg", "missing Opus headers");
  if (bound === 0) throw invalid("ogg", "no audio packets");
  if (lastGranule > bound) throw invalid("ogg", "a declared length exceeds the packets");
  const expected = lastGranule > 0 ? Math.max(0, lastGranule - preSkip) : bound;
  return {
    container: "ogg",
    codec: "opus",
    sampleRate: OPUS_RATE,
    channels,
    frameBound: bound,
    expectedFrames: expected,
    // One maximum packet, which covers the pre-skip a decoder may or may not trim.
    frameTolerance: Math.max(MAX_PACKET, preSkip),
  };
}
