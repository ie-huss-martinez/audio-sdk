import type { AudioPeaks, AudioProbe, DecodedAudio } from "../model/source.js";
import type { AudioCallOptions, AudioProgressOptions } from "./options.js";

/**
 * The port for reading audio files: probe a file's headers, decode it, and
 * build its waveform overview (ADR 0001, ADR 0003, ADR 0008). The SDK's own
 * adapter probes and parses in its worker and decodes compressed formats
 * with Web Audio; hosts can pass their own to the editor's `engine` prop, and
 * every implementation must pass the engine's contract tests.
 *
 * The engine doesn't apply the file policy: the session checks the probe
 * against it between `probe` and `decode` (ADR 0004).
 *
 * Failures reject with `AudioError`: `INVALID_AUDIO` for a malformed file,
 * `UNSUPPORTED_FORMAT` for one the probe can't bound, `DECODE_FAILED` when
 * the browser can't decode it, and sdk-core's codes for cancellation and
 * worker failures.
 *
 * @public
 */
export interface AudioEngine {
  /**
   * Reads a file's headers and walks its packets, without decoding it. It
   * reads the file through the `Blob`, never all at once.
   */
  probe(file: Blob, options?: AudioCallOptions): Promise<AudioProbe>;
  /**
   * Decodes a probed file at the probe's sample rate and channel count. A
   * result longer than the probe's bound plus its tolerance rejects with
   * `INVALID_AUDIO`; a shorter one is returned as it is.
   */
  decode(file: Blob, probe: AudioProbe, options?: AudioProgressOptions): Promise<DecodedAudio>;
  /**
   * Builds a waveform overview of decoded audio. The audio isn't modified or
   * kept.
   */
  peaks(audio: DecodedAudio, options?: AudioCallOptions): Promise<AudioPeaks>;
  /** Releases the engine and its worker. Pending calls reject, and later calls throw. */
  destroy(): Promise<void>;
}
