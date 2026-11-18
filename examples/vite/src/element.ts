import "@hussmartinez/ui/styles.css";
import "@hussmartinez/audio-sdk/styles.css";
import { defineAudioEditorElement } from "@hussmartinez/audio-sdk/element";

/**
 * The element, as a host without React uses it: ui's stylesheet first, then
 * the SDK's (sdk-core ADR 0036), and the element registered explicitly.
 */
defineAudioEditorElement();

declare global {
  interface Window {
    /** The element's events, by name and detail as JSON, for the end-to-end tests. */
    audioElementEvents: { name: string; json: string }[];
  }
}

window.audioElementEvents = [];
const editor = document.querySelector("hm-audio-editor");
for (const name of ["change", "event", "export", "error"]) {
  editor?.addEventListener(`hm-audio-editor-${name}`, (event) => {
    window.audioElementEvents.push({ name, json: JSON.stringify((event as CustomEvent).detail) });
  });
}
