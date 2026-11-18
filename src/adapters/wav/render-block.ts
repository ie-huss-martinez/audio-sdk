import { type MixBlock, mixBlock } from "../../core/model/mix.js";
import type { AudioSampleFormat } from "../../core/ports/audio-processor.js";
import { encodeSamples } from "./wav-writer.js";

/** One output block to render and encode. */
export interface RenderBlockInput extends MixBlock {
  readonly sampleFormat: AudioSampleFormat;
}

/** An encoded block, and what clamping did to it. */
export interface RenderedBlock {
  /** The block's WAV samples, interleaved. */
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** The largest absolute sample of the mix before clamping. */
  readonly peak: number;
  /** How many frames were clamped. */
  readonly clipped: number;
}

/**
 * Renders one output block (docs/adr/0006): the mix of its segments, by the
 * core's `mixBlock`, clamped, then quantised and interleaved as WAV
 * samples, with the mix's peak and the frames it clamped.
 */
export function renderBlock(input: RenderBlockInput): RenderedBlock {
  const { channels, peak, clipped } = mixBlock(input);
  return { bytes: encodeSamples(channels, input.frames, input.sampleFormat), peak, clipped };
}
