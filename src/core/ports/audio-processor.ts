import type { AudioPlan } from "../model/plan.js";
import type { DecodedAudio } from "../model/source.js";
import type { AudioProgressOptions } from "./options.js";

/**
 * How samples are stored in an exported WAV file (ADR 0001).
 *
 * @public
 */
export type AudioSampleFormat = "pcm16" | "pcm24" | "float32";

/**
 * The file an export produces. WAV is the only container so far (ADR 0001).
 *
 * @public
 */
export interface AudioExportFormat {
  readonly container: "wav";
  /** Defaults to `pcm16`. */
  readonly sampleFormat?: AudioSampleFormat;
}

/**
 * One export: a plan, the decoded sources its clips refer to, and the
 * output format. The plan's metadata goes into the file.
 *
 * @public
 */
export interface AudioRenderJob {
  readonly plan: AudioPlan;
  /** The decoded sources, by id. Every clip's source must be here. */
  readonly sources: ReadonlyMap<string, DecodedAudio>;
  readonly format: AudioExportFormat;
}

/**
 * What an export gives: the file, and what clamping did to the mix
 * (docs/adr/0006). A mix of full-scale tracks goes over full scale; export
 * clamps it rather than changing levels nobody asked to change, and says so
 * here, so an editor can offer to lower the master gain.
 *
 * @public
 */
export interface AudioRenderResult {
  /** The encoded file. */
  readonly blob: Blob;
  /**
   * The mix's peak before clamping, in decibels relative to full scale:
   * above 0 means it clipped, by that much. `-Infinity` for silence.
   */
  readonly peakDb: number;
  /** How many frames had a sample over full scale, which was clamped. */
  readonly clippedFrames: number;
}

/**
 * The port for exporting: mix a plan's audible tracks, with their clips'
 * gain and fades, and encode the result (ADR 0001, ADR 0003, ADR 0008). The SDK's own
 * adapter renders and encodes in its worker, block by block; hosts can pass
 * their own to the editor's `processor` prop, and every implementation must
 * pass the processor's contract tests.
 *
 * Failures reject with `AudioError` for cancellation and worker failures,
 * `TypeError` for a clip whose source isn't in the job, and `RangeError` for
 * a clip outside its source.
 *
 * @public
 */
export interface AudioProcessor {
  /**
   * Mixes and encodes a plan, up to where its last audible clip ends. Every
   * sample is clamped to full scale before it's quantised, so a mix above
   * full scale clips rather than wrapping around, and the result says how
   * far over it went. The sources aren't modified.
   */
  render(job: AudioRenderJob, options?: AudioProgressOptions): Promise<AudioRenderResult>;
  /** Releases the processor and its worker. Pending calls reject, and later calls throw. */
  destroy(): Promise<void>;
}
