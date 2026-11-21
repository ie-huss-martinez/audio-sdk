import { defineMessages, type Messages } from "@hussmartinez/sdk-core";
import { uiMessages } from "@hussmartinez/ui";
import type { AudioEditorMessageCatalogue } from "../messages/editor.js";
import { audioEditorText } from "../messages/editor-en.js";
import { audioMessages } from "../messages/en.js";

export type { AudioEditorMessageCatalogue } from "../messages/editor.js";

/** The text the editor's parts use: `Messages` over the editor's catalogue. Internal. */
export type EditorMessages = Messages<AudioEditorMessageCatalogue>;

/**
 * The editor's English catalogue: the SDK's messages, `ui`'s for its own
 * components, and the editor's text, as one catalogue for one `Messages`
 * object (sdk-core ADR 0046). A host overrides any of it, such as `ui`'s
 * `fileDropZone.choose`, through the editor's `messages` prop. Its type,
 * `AudioEditorMessageCatalogue`, is exported from the main entry.
 *
 * @public
 */
export const audioEditorMessages: AudioEditorMessageCatalogue = /* @__PURE__ */ defineMessages({
  ...audioMessages,
  ...uiMessages,
  ...audioEditorText,
});
