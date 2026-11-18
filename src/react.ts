"use client";

/**
 * React editor of the audio SDK: `AudioEditor`, its building blocks and
 * hooks (docs/adr/0005, docs/adr/0006).
 *
 * @remarks
 * A client entry: it starts with `"use client"`, which the build keeps
 * (ADR 0007), and does nothing on import. On a server, the editor renders
 * its empty state, with no engine, worker or `AudioContext`. React and React
 * DOM 18.3 or later are optional peer dependencies, and `@hussmartinez/ui`
 * gives its controls: load its stylesheet before this package's.
 *
 * @packageDocumentation
 */

export type { AudioEditorHandle, AudioEditorProps } from "./react/AudioEditor.js";
export { AudioEditor } from "./react/AudioEditor.js";
export type { AudioNoticesProps } from "./react/AudioNotices.js";
export { AudioNotices } from "./react/AudioNotices.js";
export type { AudioStageProps } from "./react/AudioStage.js";
export { AudioStage } from "./react/AudioStage.js";
export type { AudioTransportProps } from "./react/AudioTransport.js";
export { AudioTransport } from "./react/AudioTransport.js";
export type {
  AudioEditorProviderProps,
  AudioLoad,
  UseAudioOutputResult,
  UseAudioSessionResult,
} from "./react/context.js";
export {
  AudioEditorProvider,
  useAudioMessages,
  useAudioOutput,
  useAudioPlayhead,
  useAudioSession,
} from "./react/context.js";
export type {
  AudioEditorMessageCatalogue,
  AudioEditorMessageOverrides,
  AudioEditorMessages,
} from "./react/editor-messages.js";
export { audioEditorMessages } from "./react/editor-messages.js";
export type { AudioEditorPart } from "./react/parts.js";
