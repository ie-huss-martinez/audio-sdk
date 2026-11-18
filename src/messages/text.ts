import { isSdkError, type Messages } from "@hussmartinez/sdk-core";
import type { AudioWarning } from "../core/session/session.js";
import { type AudioMessageCatalogue, audioMessages } from "./en.js";

/**
 * The user-facing text for an error: the catalogue's text for its code and
 * `details.reason` together, `errors.<CODE>.<reason>`, when there is one,
 * and otherwise `messages.error(error)`, the text for its code. So a blocked
 * `play()` says that sound needs a press of Play, rather than that the
 * browser lacks a feature (point 9 of #54).
 *
 * sdk-core's `messages.error()` may take over this fallback for the family;
 * until then, use this one.
 *
 * @example
 * ```ts
 * const messages = createMessages(audioMessages, { locale: "en" });
 * showError(audioErrorText(messages, error));
 * ```
 *
 * @public
 */
export function audioErrorText(messages: Messages<AudioMessageCatalogue>, error: unknown): string {
  if (isSdkError(error)) {
    const details = (error.details ?? {}) as { readonly reason?: unknown };
    if (typeof details.reason === "string") {
      const key = `errors.${error.code}.${details.reason}`;
      if (Object.hasOwn(audioMessages, key)) {
        // The key is one of the catalogue's, whose parameters come from the
        // same details as its code's text.
        const catalogue = messages as unknown as { t(key: string, params: object): string };
        return catalogue.t(key, details);
      }
    }
  }
  return messages.error(error);
}

/**
 * The user-facing text for one of the snapshot's warnings, from
 * `warnings.<limit>` or `warnings.truncated`, with the parameters each needs
 * (point 12 of #54). A limit's name is known only at run time, which
 * `messages.t()` can't type, so this does it once.
 *
 * @example
 * ```ts
 * for (const warning of snapshot.warnings) show(audioWarningText(messages, warning));
 * ```
 *
 * @public
 */
export function audioWarningText(
  messages: Messages<AudioMessageCatalogue>,
  warning: AudioWarning,
): string {
  if (warning.type === "truncated") return messages.t("warnings.truncated");
  // Every limit's warning takes `actual`, or nothing, which ignores it.
  const catalogue = messages as unknown as { t(key: string, params: object): string };
  return catalogue.t(`warnings.${warning.limit}`, { actual: warning.actual });
}
