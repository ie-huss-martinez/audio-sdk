import { isSdkError, type SdkCoreErrorCode, SdkError } from "@hussmartinez/sdk-core";

/**
 * Error codes of `@hussmartinez/audio-sdk`: sdk-core's own codes, such as
 * `ABORTED`, `WORKER_CRASHED` and `FILE_TOO_LARGE`, plus the audio SDK's
 * (ADR 0004). They never change meaning once released.
 *
 * - `INVALID_AUDIO`: the file is malformed, its headers claim more audio than
 *   its packets carry, or it decodes to more than its bound allows.
 * - `UNSUPPORTED_FORMAT`: the container or codec isn't recognised, the file's
 *   packets can't be walked to a bound, or the browser can't decode at its
 *   sample rate.
 * - `DECODE_FAILED`: the browser couldn't decode a file the SDK probed,
 *   usually because it lacks the codec. `details.codec` names it.
 * - `INVALID_COMMAND`: an edit command doesn't apply to the clip plan, such
 *   as a range outside its source or an unknown clip key.
 * - `DURATION_TOO_LONG`: a file exceeds the `maxDuration` limit.
 * - `TOO_MANY_CHANNELS`: a file exceeds the `maxChannels` limit.
 * - `SAMPLE_RATE_TOO_HIGH`: a file exceeds the `maxSampleRate` limit.
 * - `SESSION_TOO_LARGE`: the decoded audio the session holds exceeds the
 *   `maxSessionSize` limit.
 * - `TOO_MANY_CLIPS`: the clip plan exceeds the `maxClips` limit.
 *
 * Limit codes carry `details` with the `limit`, its `maximum`, the `actual`
 * value and the `unit`. Other codes' `details` name the container, codec or
 * sample rate involved, never data from the file.
 *
 * @public
 */
export type AudioErrorCode =
  | SdkCoreErrorCode
  | "INVALID_AUDIO"
  | "UNSUPPORTED_FORMAT"
  | "DECODE_FAILED"
  | "INVALID_COMMAND"
  | "DURATION_TOO_LONG"
  | "TOO_MANY_CHANNELS"
  | "SAMPLE_RATE_TOO_HIGH"
  | "SESSION_TOO_LARGE"
  | "TOO_MANY_CLIPS";

/**
 * The error `@hussmartinez/audio-sdk` throws and rejects with, with a stable
 * `code`, structured `details` and the underlying error as `cause`. Show
 * users the text for its code from {@link audioMessages}, never its
 * `message`, which is for developers and may contain text from the file.
 *
 * @example
 * ```ts
 * try {
 *   await session.open(file);
 * } catch (error) {
 *   if (isAudioError(error, "DECODE_FAILED")) {
 *     suggestConvertingToWav();
 *   } else {
 *     show(messages.error(error));
 *   }
 * }
 * ```
 *
 * @public
 */
export class AudioError extends SdkError<AudioErrorCode> {
  /** Always `"AudioError"`, which survives minification and worker boundaries. */
  override readonly name = "AudioError";
}

/**
 * Checks whether a value is an {@link AudioError}, optionally with a given
 * code.
 *
 * Unlike `instanceof`, it recognises errors from another copy of this
 * package or another realm, and errors rebuilt after crossing a worker
 * boundary.
 *
 * @param value - Any thrown value.
 * @param code - When given, the error must also have this code.
 * @public
 */
export function isAudioError<Code extends AudioErrorCode = AudioErrorCode>(
  value: unknown,
  code?: Code,
): value is AudioError & { readonly code: Code } {
  return isSdkError(value, code) && value.name === "AudioError";
}
