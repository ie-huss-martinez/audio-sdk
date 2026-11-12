import { defineMessages, type MessageValue, plural, sdkCoreMessages } from "@hussmartinez/sdk-core";
import type { AudioErrorCode } from "../core/errors/audio-error.js";
import type { AudioLimitName } from "../core/errors/audio-limits.js";

/**
 * The audio SDK's English message catalogue: sdk-core's messages, and text
 * for every {@link AudioErrorCode} and every limit's warning. Pass it to
 * `createMessages` from `@hussmartinez/sdk-core`, with the host's locale and
 * overrides. The editor's text joins it as the editor arrives.
 *
 * Error text is looked up by code, with the error's `details` as
 * parameters, and never taken from `error.message` (ADR 0019).
 *
 * @example
 * ```ts
 * const messages = createMessages(audioMessages, { locale: "en", overrides: props.messages });
 * messages.error(error); // "This recording has 12 channels, which is over the 8-channel limit."
 * messages.t("warnings.maxSessionSize", { actual: 800e6 });
 * ```
 *
 * @public
 */
export const audioMessages = /* @__PURE__ */ defineMessages({
  ...sdkCoreMessages,
  "errors.INVALID_AUDIO": "This file isn't valid audio, or it's too damaged to open.",
  "errors.UNSUPPORTED_FORMAT":
    "This audio format isn't supported. Try converting the file to WAV, then open it again.",
  "errors.DECODE_FAILED":
    "This browser can't play this kind of audio. Try another browser, or convert the file to WAV.",
  "errors.INVALID_COMMAND": "This edit couldn't be made. Please try again.",
  // TODO(sdk-core#59): state the length and the limit once messages have a
  // duration format. https://github.com/ie-huss-martinez/sdk-core/issues/59
  "errors.DURATION_TOO_LONG": "This recording is longer than the editor can open.",
  "errors.TOO_MANY_CHANNELS":
    "This recording has {actual, number} channels, which is over the {maximum, number}-channel limit.",
  "errors.SAMPLE_RATE_TOO_HIGH":
    "This recording's sample rate is {actual, number} Hz, which is over the {maximum, number} Hz limit.",
  "errors.SESSION_TOO_LARGE":
    "The open recordings would use {actual, fileSize} of memory, which is over the {maximum, fileSize} limit. Remove a recording, or clear the undo history, and try again.",
  "errors.TOO_MANY_CLIPS": /* @__PURE__ */ plural("maximum", {
    one: "A recording can have {maximum} clip. Join or delete clips, and try again.",
    other: "A recording can have up to {maximum} clips. Join or delete clips, and try again.",
  }),
  "warnings.maxDuration": "This recording is long, and may be slow to open and edit.",
  "warnings.maxChannels": "This recording has {actual, number} channels, and may be slow to edit.",
  "warnings.maxSampleRate":
    "This recording's sample rate is {actual, number} Hz, and it may be slow to edit.",
  "warnings.maxSessionSize":
    "The open recordings use {actual, fileSize} of memory. Clearing the undo history frees memory.",
  "warnings.maxClips": /* @__PURE__ */ plural("actual", {
    one: "This recording has {actual} clip. Many clips may be slow to play and export.",
    other: "This recording has {actual} clips. Many clips may be slow to play and export.",
  }),
}) satisfies Record<`errors.${AudioErrorCode}`, MessageValue> &
  Record<`warnings.${AudioLimitName}`, MessageValue>;

/**
 * The type of {@link audioMessages}, for typing a host's overrides with
 * `MessageOverrides<AudioMessageCatalogue>`.
 *
 * @public
 */
export type AudioMessageCatalogue = typeof audioMessages;
