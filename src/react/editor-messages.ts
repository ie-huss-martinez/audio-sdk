import { defineMessages, type MessageOverrides, type Messages } from "@hussmartinez/sdk-core";
import { uiMessages } from "@hussmartinez/ui";
import { audioEditorText } from "../messages/editor-en.js";
import { audioMessages } from "../messages/en.js";

/**
 * The editor's English catalogue: the SDK's messages, `ui`'s for its own
 * components, and the editor's text, as one catalogue for one `Messages`
 * object (sdk-core ADR 0046). A host overrides any of it, such as `ui`'s
 * `fileDropZone.choose`, through the editor's `messages` prop.
 *
 * @public
 */
export const audioEditorMessages = /* @__PURE__ */ defineMessages({
  ...audioMessages,
  ...uiMessages,
  ...audioEditorText,
});

/**
 * The type of {@link audioEditorMessages}.
 *
 * @public
 */
export type AudioEditorMessageCatalogue = typeof audioEditorMessages;

/**
 * The text the editor uses.
 *
 * @public
 */
export type AudioEditorMessages = Messages<AudioEditorMessageCatalogue>;

/**
 * A host's overrides of the editor's text, keyed as in
 * {@link audioEditorMessages}.
 *
 * @public
 */
export type AudioEditorMessageOverrides = MessageOverrides<AudioEditorMessageCatalogue>;
