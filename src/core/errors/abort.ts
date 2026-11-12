import { isSdkError } from "@hussmartinez/sdk-core";
import { AudioError } from "./audio-error.js";

/**
 * The error an aborted call rejects with, as the family's worker client does
 * (ADR 0018, ADR 0020): the reason itself when it's an `SdkError`, such as a
 * file policy's `PROCESSING_TIME_EXCEEDED`, `TIMEOUT` for a timeout, and
 * `ABORTED` otherwise. The reason is kept as `cause`.
 *
 * @internal
 */
export function abortError(signal: AbortSignal): AudioError {
  const { reason } = signal;
  if (reason instanceof AudioError) {
    return reason;
  }
  if (isSdkError(reason)) {
    return new AudioError(reason.code as never, reason.message, {
      ...(reason.details === undefined ? {} : { details: reason.details }),
      cause: reason,
    });
  }
  const timedOut = reason instanceof DOMException && reason.name === "TimeoutError";
  return new AudioError(
    timedOut ? "TIMEOUT" : "ABORTED",
    timedOut ? "The operation timed out." : "The operation was cancelled.",
    { cause: reason },
  );
}

/**
 * Throws {@link abortError} if the signal has been aborted.
 *
 * @internal
 */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal);
  }
}
