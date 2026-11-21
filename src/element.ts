/**
 * The `<hm-audio-editor>` custom element of the audio SDK.
 *
 * @remarks
 * Importing this entry registers nothing: applications call
 * `defineAudioEditorElement()` themselves, and importing it on a server does
 * nothing (sdk-core ADR 0004, ADR 0007). The element renders
 * `<AudioEditor>` into its light DOM, so React and React DOM, the package's
 * optional peer dependencies, are needed here. Hosts import
 * `@hussmartinez/ui/styles.css` once, then this package's `styles.css`
 * (sdk-core ADR 0036).
 *
 * @packageDocumentation
 */

import { createEditorElement } from "@hussmartinez/sdk-core/element";
import { toHeadingLevel } from "@hussmartinez/ui";
import type { AudioExportReport } from "./react/element/listeners.js";
import {
  type AudioEditorElementEvent,
  type AudioEditorElementMethods,
  type AudioEditorElementProps,
  mountAudioEditor,
} from "./react/element/mount.js";

export type {
  AudioEditorElementEvent,
  AudioEditorElementMethods,
  AudioEditorElementProps,
  AudioExportReport,
};

/** A space-separated list, as the `tools` attribute holds. */
const words = (value: string): readonly string[] => value.split(/\s+/).filter(Boolean);

/**
 * Registers `<hm-audio-editor>`, or the tag you name, and returns its class
 * (docs/adr/0005, sdk-core ADR 0040), as image-sdk's element does: the
 * attributes `theme`, `locale`, `tools` and `heading-level` (also the
 * property `headingLevel`); the properties `file`, `fileName`,
 * `filePolicy`, `assetsUrl`, `messages`, `engine`, `processor` and
 * `output`; the methods `open`, `insert`,
 * `export`, `undo`, `redo`, `play`, `pause` and `seek`; and the events
 * `hm-audio-editor-change`, `-event`, `-export` and `-error`. Calling it
 * again returns the same class.
 *
 * @example
 * ```ts
 * import { defineAudioEditorElement } from "@hussmartinez/audio-sdk/element";
 *
 * defineAudioEditorElement();
 * const editor = document.querySelector("hm-audio-editor");
 * editor.file = file;
 * editor.addEventListener("hm-audio-editor-change", (event) => save(event.detail));
 * ```
 *
 * @public
 */
export const defineAudioEditorElement = /* @__PURE__ */ createEditorElement<
  Partial<AudioEditorElementProps>,
  AudioEditorElementMethods,
  AudioEditorElementEvent
>({
  kind: "audio",
  attributes: {
    theme: "theme",
    locale: "locale",
    tools: { property: "tools", parse: words },
    // As text: anything but 2 to 6 is the default, 2 (sdk-core ADR 0058).
    "heading-level": { property: "headingLevel", parse: toHeadingLevel },
  },
  properties: [
    "file",
    "fileName",
    "filePolicy",
    "assetsUrl",
    "messages",
    "engine",
    "processor",
    "output",
  ],
  methods: ["open", "insert", "export", "undo", "redo", "play", "pause", "seek"],
  events: ["change", "event", "export", "error"],
  mount: mountAudioEditor,
});
