import type { DecodedAudio } from "../../src/index.js";

/**
 * A tiny "fake audio" file format for the fakes: JSON with a magic string.
 * Its fields let tests describe honest files, files whose header lies about
 * their length, and decoders that return more than the probe allows.
 */
export interface FakeAudioFile {
  readonly sampleRate: number;
  /** Samples per channel. Every channel has the same length. */
  readonly samples: readonly (readonly number[])[];
  /** The length the header declares. Defaults to the real length. */
  readonly declaredFrames?: number;
  /**
   * Makes the file an uncompressed one cut short, as by an interrupted
   * recording: a `declaredFrames` beyond the samples opens with the samples,
   * and the probe reports the declared length, instead of failing.
   */
  readonly truncated?: boolean;
  /**
   * The channel count the probe reports, when it's more than the decoder
   * returns, as for mono AAC, which probes as two channels.
   */
  readonly probeChannels?: number;
  /** Extra silent frames the fake decoder returns beyond the real length. */
  readonly decoderExtraFrames?: number;
  /** A codec the fake decoder doesn't have, as a browser might lack one. */
  readonly undecodable?: boolean;
}

const MAGIC = "FAKEAUDIO1";

/** The frames beyond the bound the fake decoder may return, like one codec frame. */
export const FAKE_TOLERANCE = 4;

export function encodeFakeAudio(file: FakeAudioFile): Blob {
  return new Blob([MAGIC, JSON.stringify(file)], { type: "application/x-fake-audio" });
}

/** The file, `undefined` when it isn't fake audio, or "invalid" when it's malformed. */
export async function decodeFakeAudio(blob: Blob): Promise<FakeAudioFile | "invalid" | undefined> {
  const text = await blob.text();
  if (!text.startsWith(MAGIC)) return undefined;
  try {
    const file = JSON.parse(text.slice(MAGIC.length)) as FakeAudioFile;
    const length = file.samples[0]?.length ?? 0;
    const valid =
      Number.isInteger(file.sampleRate) &&
      file.sampleRate > 0 &&
      file.samples.length > 0 &&
      file.samples.every((channel) => channel.length === length);
    return valid ? file : "invalid";
  } catch {
    return "invalid";
  }
}

/** Decoded audio in memory, standing in for an `AudioBuffer`. */
export function fakeDecoded(
  sampleRate: number,
  channels: readonly (readonly number[] | Float32Array)[],
): DecodedAudio {
  const data = channels.map((channel) => Float32Array.from(channel));
  return {
    sampleRate,
    length: data[0]?.length ?? 0,
    numberOfChannels: data.length,
    getChannelData(channel) {
      const samples = data[channel];
      if (!samples) throw new RangeError(`No channel ${channel}.`);
      return samples;
    },
  };
}
