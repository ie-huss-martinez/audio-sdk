import type { MessageOverrides, Messages } from "@hussmartinez/sdk-core";
import type { uiMessages } from "@hussmartinez/ui";
import type { audioEditorText } from "./editor-en.js";
import type { audioMessages } from "./en.js";

/**
 * The shape of the editor's catalogue, `audioEditorMessages`: the SDK's
 * messages, `ui`'s for its own components, and the editor's text, as one
 * catalogue for one `Messages` object (sdk-core ADR 0046). Exported from the
 * main entry, because the React editor and the element both use it (sdk-core
 * ADR 0033).
 *
 * @public
 */
export type AudioEditorMessageCatalogue = typeof audioMessages &
  typeof uiMessages &
  typeof audioEditorText;

/**
 * The text the editor uses.
 *
 * @deprecated Use `Messages<AudioEditorMessageCatalogue>`, from sdk-core's
 * `Messages`, as the family names it (sdk-core ADR 0059). This goes in the
 * next breaking release.
 *
 * @public
 */
export type AudioEditorMessages = Messages<AudioEditorMessageCatalogue>;

/**
 * A host's overrides of the editor's text, keyed as in
 * `audioEditorMessages`, and `ui`'s keys, such as `fileDropZone.choose`, for
 * its components in the editor.
 *
 * @deprecated Use `MessageOverrides<AudioEditorMessageCatalogue>`, from
 * sdk-core's `MessageOverrides`, as the family names it (sdk-core ADR
 * 0059). This goes in the next breaking release.
 *
 * @public
 */
export type AudioEditorMessageOverrides = MessageOverrides<AudioEditorMessageCatalogue>;
