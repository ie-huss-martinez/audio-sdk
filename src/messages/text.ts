import type { Messages } from "@hussmartinez/sdk-core";
import type { AudioWarning } from "../core/session/session.js";
import type { AudioMessageCatalogue } from "./en.js";

/**
 * The user-facing text for an error: `messages.error(error)`, which looks
 * for the catalogue's text for the error's code and `details.reason`
 * together, `errors.<CODE>.<reason>`, before the text for its code (sdk-core
 * ADR 0050).
 *
 * @deprecated Call `messages.error(error)` instead, which does the same
 * since sdk-core 0.4.6. This goes in the next breaking release.
 *
 * @public
 */
export function audioErrorText(messages: Messages<AudioMessageCatalogue>, error: unknown): string {
  return messages.error(error);
}

/**
 * The user-facing text for one of the snapshot's warnings:
 * `messages.warning(warning)`, from `warnings.<limit>` with its `actual`, or
 * `warnings.truncated` (sdk-core ADR 0050).
 *
 * @deprecated Call `messages.warning(warning)` instead, which does the same
 * since sdk-core 0.4.6. This goes in the next breaking release.
 *
 * @public
 */
export function audioWarningText(
  messages: Messages<AudioMessageCatalogue>,
  warning: AudioWarning,
): string {
  return messages.warning(warning);
}
