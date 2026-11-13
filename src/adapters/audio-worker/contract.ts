import type { AudioProbe } from "../../core/model/source.js";
import type { PcmLayout } from "../pcm/layout.js";
import type { RenderBlockInput } from "../wav/render-block.js";
import type { WavSpec } from "../wav/wav-writer.js";

/** A block of samples, with the peaks of its buckets for the waveform overview. */
export interface SampleBlock {
  /** One array of samples per channel. */
  readonly channels: Float32Array[];
  readonly min: Float32Array[];
  readonly max: Float32Array[];
}

/**
 * The audio worker's RPC contract (docs/adr/0002), shared by the page and the
 * worker. The worker keeps no state between calls: the page sends the file,
 * a `Blob` that crosses the boundary by reference, with every call.
 */
export interface AudioWorkerContract {
  /** Reads a file's headers, and walks its packets (docs/adr/0001). */
  readonly probe: {
    readonly input: { readonly file: Blob };
    /** Uncompressed files also get the layout their parser needs. */
    readonly output: { readonly probe: AudioProbe; readonly layout?: PcmLayout };
  };
  /** Reads and converts a block of an uncompressed file, with its peaks. */
  readonly readBlock: {
    readonly input: {
      readonly file: Blob;
      readonly layout: PcmLayout;
      readonly start: number;
      readonly frames: number;
      readonly bucket: number;
    };
    readonly output: SampleBlock;
  };
  /**
   * An export's WAV header, which the plan fixes in advance (docs/adr/0003).
   * The worker keeps no state between an export's calls.
   */
  readonly wavHeader: {
    readonly input: WavSpec;
    readonly output: Uint8Array<ArrayBuffer>;
  };
  /** Renders one output block of an export, and encodes it as WAV samples. */
  readonly renderBlock: {
    readonly input: RenderBlockInput;
    readonly output: Uint8Array<ArrayBuffer>;
  };
  /** The peaks of a block of decoded samples, for audio the worker didn't parse. */
  readonly peaks: {
    readonly input: { readonly channels: Float32Array[]; readonly bucket: number };
    readonly output: { readonly min: Float32Array[]; readonly max: Float32Array[] };
  };
}
