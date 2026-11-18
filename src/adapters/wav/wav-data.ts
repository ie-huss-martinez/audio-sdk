import type { AudioSampleFormat } from "../../core/ports/audio-processor.js";

/**
 * The size of a WAV file's samples (docs/adr/0001), on its own: the
 * processor checks an export against the limits with it, so the page loads
 * this and not the rest of a file's layout.
 */

const BYTES: Record<AudioSampleFormat, number> = { pcm16: 2, pcm24: 3, float32: 4 };

/** Bytes per sample of a format. */
export function bytesPerSample(format: AudioSampleFormat): number {
  return BYTES[format];
}

/** The size of the samples, without the pad byte an odd size needs. */
export function dataSize(spec: {
  readonly channels: number;
  readonly frames: number;
  readonly sampleFormat: AudioSampleFormat;
}): number {
  return spec.frames * spec.channels * BYTES[spec.sampleFormat];
}
