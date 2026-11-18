/**
 * Options every port call accepts.
 *
 * @public
 */
export interface AudioCallOptions {
  /**
   * Cancels the call. It then rejects with an `AudioError` whose code is
   * `ABORTED`, `TIMEOUT`, or the code of an `SdkError` given as the abort
   * reason, such as `PROCESSING_TIME_EXCEEDED`.
   */
  readonly signal?: AbortSignal;
}

/**
 * Options for long calls, which report how far they've got.
 *
 * @public
 */
export interface AudioProgressOptions extends AudioCallOptions {
  /**
   * Called with the fraction done, from 0 to 1. It only moves forward, and
   * it's called with 1 before the call resolves.
   */
  readonly onProgress?: (fraction: number) => void;
}

/**
 * Options for `AudioEngine.decode`.
 *
 * @public
 */
export interface AudioDecodeOptions extends AudioProgressOptions {
  /**
   * The sample rate to return the audio at, in hertz, when it isn't the
   * probe's: the engine converts it, as the session asks for a recording
   * inserted at another rate than its own (docs/adr/0006). The result then
   * has `Math.ceil(frames × sampleRate / probe.sampleRate)` frames, which
   * cover the same time.
   */
  readonly sampleRate?: number;
}
