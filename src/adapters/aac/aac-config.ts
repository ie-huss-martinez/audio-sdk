import { invalid } from "../pcm/layout.js";

/** AAC's sampling frequency table, by index. @internal */
export const AAC_RATES = [
  96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8_000,
  7_350,
];

/** What the probe needs from an AudioSpecificConfig. @internal */
export interface AacConfig {
  readonly coreRate: number;
  readonly channelConfiguration: number;
}

/**
 * Reads an AudioSpecificConfig's core rate and channel configuration: 5 bits
 * of object type (31 escapes to 6 more), 4 of rate index (15 escapes to 24
 * bits of rate), then 4 of channel configuration.
 *
 * @internal
 */
export function parseAudioSpecificConfig(bytes: Uint8Array, container: string): AacConfig {
  let bits = 0;
  let value = 0;
  let index = 0;
  const read = (count: number): number => {
    let out = 0;
    for (let i = 0; i < count; i += 1) {
      if (bits === 0) {
        if (index >= bytes.length) throw invalid(container, "truncated AudioSpecificConfig");
        value = bytes[index] as number;
        index += 1;
        bits = 8;
      }
      bits -= 1;
      out = out * 2 + ((value >> bits) & 1);
    }
    return out;
  };
  if (read(5) === 31) read(6);
  const rateIndex = read(4);
  const coreRate = rateIndex === 15 ? read(24) : AAC_RATES[rateIndex];
  if (coreRate === undefined || coreRate === 0) {
    throw invalid(container, "AAC sample rate out of range");
  }
  return { coreRate, channelConfiguration: read(4) };
}

/**
 * The channels an AAC decoder can output for a configuration: at least two,
 * because HE-AAC v2's parametric stereo turns mono into stereo, and eight
 * when a program config element, not the header, decides (docs/adr/0001).
 *
 * @internal
 */
export function aacOutputChannels(configuration: number): number {
  if (configuration === 0 || configuration === 7) return 8;
  return Math.max(2, configuration);
}

/**
 * The rate AAC decodes at: twice the core rate at 24 kHz or less, as HE-AAC
 * streams are, so implicit SBR fits, and the core rate otherwise
 * (docs/adr/0001).
 *
 * @internal
 */
export function aacDecodeRate(coreRate: number): number {
  return coreRate <= 24_000 ? coreRate * 2 : coreRate;
}
