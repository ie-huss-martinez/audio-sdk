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
