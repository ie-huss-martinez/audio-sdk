import type { AudioProbe } from "../../core/model/source.js";
import { WindowReader } from "../bytes/window-reader.js";
import { findStream, scanFrames } from "../mpeg/scan.js";
import { invalid } from "../pcm/layout.js";

/** An ADTS frame header. @internal */
export interface AdtsHeader {
  readonly sampleRate: number;
  /** The channel configuration: 0 means "as a program config element says". */
  readonly channelConfiguration: number;
  /** AAC frames (raw data blocks) in this ADTS frame, each of 1,024 core samples. */
  readonly blocks: number;
  readonly frameLength: number;
}

const RATES = [
  96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8_000,
  7_350,
];

/**
 * Reads an ADTS header at `offset`, if there's a valid one: the 12-bit sync,
 * layer 0, a defined sample rate, and a frame long enough for its header.
 *
 * @internal
 */
export function readAdtsHeader(bytes: Uint8Array, offset: number): AdtsHeader | undefined {
  const b = (i: number) => bytes[offset + i];
  const b1 = b(1);
  const b2 = b(2);
  const b3 = b(3);
  const b4 = b(4);
  const b5 = b(5);
  const b6 = b(6);
  if (b(0) !== 0xff || b1 === undefined || b2 === undefined || b3 === undefined) return undefined;
  if (b4 === undefined || b5 === undefined || b6 === undefined) return undefined;
  if ((b1 & 0xf6) !== 0xf0) return undefined; // sync, and layer 0
  const rateIndex = (b2 >> 2) & 0xf;
  const sampleRate = RATES[rateIndex];
  if (sampleRate === undefined) return undefined;
  const channelConfiguration = ((b2 & 0x1) << 2) | (b3 >> 6);
  const frameLength = ((b3 & 0x3) << 11) | (b4 << 3) | (b5 >> 5);
  const headerLength = b1 & 0x1 ? 7 : 9;
  if (frameLength < headerLength) return undefined;
  return { sampleRate, channelConfiguration, blocks: (b6 & 0x3) + 1, frameLength };
}

/**
 * The channels a decoder can output for a configuration: at least two,
 * because HE-AAC v2's parametric stereo turns mono into stereo, and eight
 * when a program config element, not the header, decides (docs/adr/0001).
 */
function outputChannels(configuration: number): number {
  if (configuration === 0 || configuration === 7) return 8;
  return Math.max(2, configuration);
}

const sameStream = (a: AdtsHeader, b: AdtsHeader) =>
  a.sampleRate === b.sampleRate && a.channelConfiguration === b.channelConfiguration;

/**
 * Finds an ADTS stream at or just after `start`, for the dispatcher.
 *
 * @internal
 */
export async function findAdts(file: Blob, start: number) {
  return findStream(
    new WindowReader(file),
    start,
    64 * 1_024,
    readAdtsHeader,
    (h) => h.frameLength,
    sameStream,
  );
}

/**
 * Probes an ADTS AAC stream (docs/adr/0001).
 *
 * - **Every AAC frame counts as possibly HE-AAC,** which a decoder may detect
 *   without the header saying so (implicit SBR) and decode to 2,048 samples
 *   at twice the core rate. The probe decodes at twice the core rate when
 *   the core rate is 24 kHz or less, as HE-AAC streams are, and at the core
 *   rate otherwise; either way an AAC frame is at most
 *   `1,024 × ceil(decode rate ÷ its core rate)` frames of output.
 * - **Channels count as the configuration allows,** at least two.
 * - **Every valid header counts,** at its worst case, as for MP3 and native
 *   FLAC.
 *
 * @internal
 */
export async function probeAdts(file: Blob, start: number): Promise<AudioProbe> {
  const reader = new WindowReader(file);
  const found = await findStream(
    reader,
    start,
    64 * 1_024,
    readAdtsHeader,
    (h) => h.frameLength,
    sameStream,
  );
  if (!found) throw invalid("adts", "no frames");
  const core = found.first.sampleRate;
  const sampleRate = core <= 24_000 ? core * 2 : core;
  const channels = outputChannels(found.first.channelConfiguration);
  const perBlock = 1_024 * Math.ceil(sampleRate / core);

  let bound = 0;
  let chainBlocks = 0;
  await scanFrames(
    reader,
    found.offset,
    7,
    readAdtsHeader,
    (h) => h.frameLength,
    (header, inChain) => {
      const resample = Math.max(1, Math.ceil(sampleRate / header.sampleRate));
      const wider = Math.ceil(outputChannels(header.channelConfiguration) / channels);
      bound += header.blocks * 1_024 * resample * wider;
      if (inChain) chainBlocks += header.blocks;
    },
  );
  if (bound === 0) throw invalid("adts", "no frames");
  return {
    container: "adts",
    codec: "aac",
    sampleRate,
    channels,
    frameBound: bound,
    expectedFrames: Math.min(chainBlocks * perBlock, bound),
    // Two access units at the decode rate, which covers AAC's priming.
    frameTolerance: 2 * perBlock,
  };
}
