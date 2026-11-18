import "@hussmartinez/ui/styles.css";
import "@hussmartinez/audio-sdk/styles.css";
import type { AudioPlan } from "@hussmartinez/audio-sdk";
import {
  AudioEditor,
  type AudioEditorHandle,
  type AudioEditorMessageOverrides,
} from "@hussmartinez/audio-sdk/react";
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

/**
 * Text much longer than English, as a translation can be, for the visual
 * tests' long-text states (sdk-core ADR 0048): `?long-text`. `?dir=rtl` lays
 * the page out right to left.
 */
const LONG_TEXT: AudioEditorMessageOverrides = {
  "editor.empty":
    "Ziehen Sie eine Audiodatei hierher oder wählen Sie eine aus. Sie bleibt jederzeit auf diesem Gerät.",
  "timeline.track": "Tonspur Nummer {index}",
  "track.mute": "Stummschalten",
  "track.solo": "Allein wiedergeben",
  "track.gain": "Lautstärke der Spur",
  "rename.title": "Die Tonspur umbenennen",
  "rename.name": "Name der Tonspur",
  "rename.description": "Lassen Sie das Feld leer, wenn die Spur keinen Namen haben soll.",
  "rename.save": "Umbenennen",
  "inspector.recording": "Aufnahme und ihre Eigenschaften",
  "inspector.length": "Gesamtlänge",
  "inspector.sampleRate": "Abtastrate der Aufnahme",
  "inspector.tracks": "Anzahl der Tonspuren",
  "inspector.masterGain": "Gesamtlautstärke",
  "inspector.masterGainExact": "Gesamtlautstärke, in Dezibel",
  "inspector.channels": "Kanäle",
  "inspector.mono": "Mono, ein Kanal",
  "inspector.stereo": "Stereo, zwei Kanäle",
  "metadata.title": "Titel des Stücks",
  "metadata.artist": "Interpretin oder Interpret",
  "export.title": "Aufnahme als Datei exportieren",
  "export.description": "Schreiben Sie die Aufnahme als WAV-Datei auf dieses Gerät.",
  "export.noMetadata": "In die Datei werden keine Metadaten geschrieben.",
  "export.private":
    "Nur die Mischung und diese Metadaten werden geschrieben. Nichts verlässt Ihr Gerät.",
  "export.cancel": "Abbrechen",
  "export.confirm": "Jetzt exportieren",
};
const params = new URLSearchParams(location.search);
if (params.get("dir") === "rtl") document.documentElement.dir = "rtl";
const messages = params.has("long-text") ? LONG_TEXT : undefined;

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
        {...(messages ? { messages, locale: "de" } : {})}
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
