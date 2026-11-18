import "@hussmartinez/ui/styles.css";
import "@hussmartinez/audio-sdk/styles.css";
import type { AudioPlan } from "@hussmartinez/audio-sdk";
import { AudioEditor, type AudioEditorHandle } from "@hussmartinez/audio-sdk/react";
import { createRoot } from "react-dom/client";

/** The editor, as a host renders it: ui's stylesheet first, then the SDK's (sdk-core ADR 0036). */
let latest: AudioPlan | null = null;

/**
 * The editor's handle, once it has mounted. React commits the editor in a
 * task of its own, which can run after the page's `load` event, so a test
 * waits for it rather than finding no editor yet.
 */
let mount: (editor: AudioEditorHandle) => void = () => {};
const mounted = new Promise<AudioEditorHandle>((resolve) => {
  mount = resolve;
});

declare global {
  interface Window {
    /** The editor, for the end-to-end tests. */
    audioEditor: {
      /** Opens a recording, waiting for the editor to mount first. */
      open(bytes: ArrayBuffer): Promise<void>;
      /** Adds a recording on a track of its own. */
      insert(bytes: ArrayBuffer): Promise<void>;
      /** The latest plan, from `onChange`, or `null` before one opens. */
      plan(): AudioPlan | null;
    };
  }
}

window.audioEditor = {
  open: async (bytes) => (await mounted).open(new Blob([bytes], { type: "audio/wav" })),
  insert: async (bytes) => (await mounted).insert(new Blob([bytes], { type: "audio/wav" })),
  plan: () => latest,
};

const element = document.querySelector("#editor");
if (element) {
  createRoot(element).render(
    <div style={{ height: "80vh" }}>
      <AudioEditor
        ref={(editor) => {
          if (editor) mount(editor);
        }}
        onChange={(plan) => {
          latest = plan;
        }}
      />
    </div>,
  );
}
