import { createErrorHelpers } from "@hussmartinez/sdk-core";
import { AudioError } from "./audio-error.js";

/**
 * The audio SDK's error helpers, from sdk-core's `createErrorHelpers`, so
 * every SDK adapts failures and aborts the same way (ADR 0018, ADR 0020).
 *
 * - `asAudioError`: makes any failure an `AudioError`, as every port
 *   promises. Another `SdkError`, such as the worker client's `ABORTED` or
 *   `WORKER_CRASHED`, keeps its code, details and message, and anything else
 *   becomes `UNKNOWN`, with the original as `cause`.
 * - `abortError`: the error an aborted call rejects with: the reason itself
 *   when it's an `SdkError`, such as the file policy's
 *   `PROCESSING_TIME_EXCEEDED`, `TIMEOUT` for a timeout, and `ABORTED`
 *   otherwise.
 * - `throwIfAborted`: throws `abortError` if the signal has been aborted.
 *
 * @internal
 */
export const {
  adapt: asAudioError,
  abortError,
  throwIfAborted,
} = /* @__PURE__ */ createErrorHelpers(AudioError, {
  fallbackCode: "UNKNOWN",
  fallbackMessage: "Audio processing failed.",
});
