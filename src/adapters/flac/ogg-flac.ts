import type { AudioProbe } from "../../core/model/source.js";
import { walkOgg } from "../ogg/ogg.js";
import { invalid } from "../pcm/layout.js";
import { readFrameHeader, readStreamInfo, STREAMINFO_LENGTH, type StreamInfo } from "./flac.js";

/** The FLAC-in-Ogg mapping's first packet: 0x7F "FLAC", version, header count, then "fLaC" and STREAMINFO. */
const MAPPING_HEADER = 13;

/**
 * Whether a first Ogg packet is FLAC's.
 *
 * @internal
 */
export function isOggFlac(head: Uint8Array): boolean {
  return (
    head[0] === 0x7f && head[1] === 0x46 && head[2] === 0x4c && head[3] === 0x41 && head[4] === 0x43
  );
}

/**
 * Probes FLAC in Ogg (docs/adr/0001). Every audio packet is exactly one FLAC
 * frame, so the bound is the sum of their block sizes, read from each
 * frame's header. A packet whose header doesn't parse counts as
 * STREAMINFO's largest block, which can only raise the bound. A valid header
 * that disagrees with STREAMINFO's channels or sample rate fails with
 * `INVALID_AUDIO`, and so does a last granule position, or a STREAMINFO
 * total, that claims more than the packets carry.
 *
 * @internal
 */
export async function probeOggFlac(file: Blob): Promise<AudioProbe> {
  let info: StreamInfo | undefined;
  let packets = 0;
  let headerPackets = 0;
  let bound = 0;
  let frames = 0;

  const { lastGranule } = await walkOgg(file, ({ head }) => {
    packets += 1;
    if (packets === 1) {
      if (!isOggFlac(head) || head[5] !== 1) throw invalid("ogg", "not a FLAC mapping version 1");
      const signature = String.fromCharCode(...head.subarray(9, 13));
      const blockType = (head[MAPPING_HEADER] ?? 0x7f) & 0x7f;
      if (signature !== "fLaC" || blockType !== 0) throw invalid("ogg", "missing FLAC STREAMINFO");
      info = readStreamInfo(
        head.subarray(MAPPING_HEADER + 4, MAPPING_HEADER + 4 + STREAMINFO_LENGTH),
        "ogg",
      );
      headerPackets = ((head[7] ?? 0) << 8) | (head[8] ?? 0);
      return;
    }
    if (!info) return;
    // Metadata packets, as many as the mapping declares; when it declares
    // none ("unknown"), until the first packet that starts with a frame sync.
    const isFrame = head[0] === 0xff && ((head[1] ?? 0) & 0xfe) === 0xf8;
    if (packets - 1 <= headerPackets || (headerPackets === 0 && !isFrame && frames === 0)) return;

    frames += 1;
    const header = readFrameHeader(head, 0);
    if (!header) {
      bound += info.maxBlockSize;
      return;
    }
    if (header.channels !== info.channels) {
      throw invalid("ogg", "a frame's channel count differs from STREAMINFO");
    }
    if (header.sampleRate !== undefined && header.sampleRate !== info.sampleRate) {
      throw invalid("ogg", "a frame's sample rate differs from STREAMINFO");
    }
    bound += header.blockSize;
  });

  if (!info) throw invalid("ogg", "missing FLAC header");
  if (frames === 0) throw invalid("ogg", "no audio frames");
  if (info.totalFrames > bound || lastGranule > bound) {
    throw invalid("ogg", "a declared length exceeds the frames");
  }
  const declared = lastGranule > 0 ? lastGranule : info.totalFrames;
  return {
    container: "ogg",
    codec: "flac",
    sampleRate: info.sampleRate,
    channels: info.channels,
    frameBound: bound,
    expectedFrames: declared > 0 ? declared : bound,
    frameTolerance: info.maxBlockSize,
  };
}
