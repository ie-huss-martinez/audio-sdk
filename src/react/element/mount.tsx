import type { EditorElementContext, MountedEditor } from "@hussmartinez/sdk-core/element";
import { type ReactNode, type RefCallback, useEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import { AudioError } from "../../core/errors/audio-error.js";
import type { AudioFilePolicyOverrides } from "../../core/errors/audio-limits.js";
import type { AudioEngine } from "../../core/ports/audio-engine.js";
import type { AudioOutput } from "../../core/ports/audio-output.js";
import type { AudioProcessor, AudioRenderResult } from "../../core/ports/audio-processor.js";
import type { AudioInsertOptions, AudioSessionExportOptions } from "../../core/session/session.js";
import type { AudioEditorMessageOverrides } from "../../messages/editor.js";
import { AudioEditor, type AudioEditorHandle } from "../AudioEditor.js";
import { type AudioExportReport, ElementListenersContext } from "./listeners.js";

/**
 * The `<hm-audio-editor>` element's props: its attributes, `theme`, `locale`
 * and `tools`, and its properties (docs/adr/0005). They're writable, since a
 * host sets them on the element, such as `editor.file = file`.
 *
 * @public
 */
export interface AudioEditorElementProps {
  /** `light`, `dark` or `system`: ui's colour mode, on the element. Inherited when unset. */
  theme?: string;
  /** The locale for numbers and plurals. Defaults to `"en"`. */
  locale?: string;
  /** Which tools are present, by id, in order: the attribute is space-separated. */
  tools?: readonly string[];
  /** A recording to open. Setting another opens it, replacing the current one. */
  file?: Blob;
  /** The name an export is downloaded under, without its extension. */
  fileName?: string;
  /** The level of the editor's headings, from 2 to 6. Defaults to 2. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  filePolicy?: AudioFilePolicyOverrides;
  /** Where the application serves the package's `dist/assets/` directory. */
  assetsUrl?: string | URL;
  /** Text overrides, typed against the English catalogue. */
  messages?: AudioEditorMessageOverrides;
  engine?: AudioEngine;
  processor?: AudioProcessor;
  output?: AudioOutput;
}

/**
 * The `<hm-audio-editor>` element's methods, as the React editor's ref handle
 * has them. `open()`, `insert()`, `export()` and `play()` wait for the
 * editor's first render, and call it at once after that; the others act on
 * the editor there is, and do nothing before it. If the element is removed
 * before its first render, the waiting calls reject with `ABORTED` and
 * `details.reason: "removed"`.
 *
 * @public
 */
export interface AudioEditorElementMethods {
  /** Opens a recording, replacing the current one once it has opened. */
  open(file: Blob): Promise<void>;
  /** Adds a recording on a new track, or on `options.track`. */
  insert(file: Blob, options?: AudioInsertOptions): Promise<void>;
  /**
   * Exports the plan as it is now, without the editor's dialog, as the
   * handle's `export` does: it resolves with the file, the mix's peak and
   * how many frames were clamped, and never downloads anything.
   */
  export(options?: AudioSessionExportOptions): Promise<AudioRenderResult>;
  undo(): void;
  redo(): void;
  play(): Promise<void>;
  pause(): void;
  /** Moves the playhead to a timeline frame. */
  seek(frame: number): void;
}

/**
 * The element's events, fired as `hm-audio-editor-<name>`. None carries a
 * file name or contents (sdk-core ADR 0012):
 *
 * - `change`: the plan, after each committed edit, open, undo or redo.
 * - `event`: the session's anonymous usage event.
 * - `export`: an {@link AudioExportReport} after the export dialog finishes.
 * - `error`: `{ code, details }` of a failure the editor shows.
 *
 * @public
 */
export type AudioEditorElementEvent = "change" | "event" | "export" | "error";

const MODES = new Set(["light", "dark", "system"]);

interface ElementEditorProps {
  readonly values: Partial<AudioEditorElementProps>;
  readonly setHandle: RefCallback<AudioEditorHandle>;
  readonly handle: { readonly current: AudioEditorHandle | null };
  readonly dispatch: EditorElementContext<AudioEditorElementEvent>["dispatch"];
}

function ElementEditor(props: ElementEditorProps): ReactNode {
  const { values, setHandle, handle, dispatch } = props;
  const { file, theme: _theme, ...editorProps } = values;

  // A file opens when it's set, and another replaces it. A failure is the
  // editor's to show, and the element's `error` event.
  const opened = useRef<Blob | undefined>(undefined);
  useEffect(() => {
    if (!file || file === opened.current) return;
    opened.current = file;
    handle.current?.open(file).catch(() => {});
  }, [file, handle]);

  const listeners = useMemo(
    () => ({
      onExport: (report: AudioExportReport) => dispatch("export", report),
      onError: (error: { code: string; details: Readonly<Record<string, unknown>> }) =>
        dispatch("error", error),
    }),
    [dispatch],
  );

  return (
    <ElementListenersContext.Provider value={listeners}>
      <AudioEditor
        ref={setHandle}
        {...editorProps}
        onChange={(plan) => dispatch("change", plan)}
        onEvent={(event) => dispatch("event", event)}
      />
    </ElementListenersContext.Provider>
  );
}

/** What a call waiting for an editor that was removed first rejects with. */
const removed = (): AudioError =>
  new AudioError("ABORTED", "The element was removed before its editor was ready.", {
    details: { reason: "removed" },
  });

/**
 * Renders `<AudioEditor>` into the element's light DOM, for
 * `createEditorElement` (sdk-core ADR 0040), as image-sdk's element does.
 * It renders without `flushSync`, since the element may connect during a
 * host's React commit; so `open()`, `insert()`, `export()` and `play()` wait
 * for the first render, and the others act on the editor there is. A removal
 * before the first render unmounts the editor before it ever renders, so the
 * waiting calls reject with `ABORTED` instead of waiting forever.
 */
export function mountAudioEditor(
  host: HTMLElement,
  initial: Partial<AudioEditorElementProps>,
  context: EditorElementContext<AudioEditorElementEvent>,
): MountedEditor<Partial<AudioEditorElementProps>, AudioEditorElementMethods> {
  const root = createRoot(host);
  const handle: { current: AudioEditorHandle | null } = { current: null };
  let resolveReady: () => void = () => {};
  let rejectReady: (reason: AudioError) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // A removal before the first render rejects it, whether or not a call waits.
  ready.catch(() => {});
  const setHandle: RefCallback<AudioEditorHandle> = (editor) => {
    handle.current = editor;
    if (editor) resolveReady();
  };
  const dispatch = context.dispatch;

  const render = (values: Partial<AudioEditorElementProps>) => {
    // The colour mode is ui's attribute on the element itself, so changing it
    // never re-renders the editor.
    const mode = values.theme;
    if (mode && MODES.has(mode)) host.setAttribute("data-hm-theme", mode);
    else host.removeAttribute("data-hm-theme");
    root.render(
      <ElementEditor values={values} setHandle={setHandle} handle={handle} dispatch={dispatch} />,
    );
  };
  render(initial);

  const now = (): AudioEditorHandle | null => handle.current;
  // Runs a method on the editor there is: at once once it has rendered, so
  // calls made in one task keep their order, and after the first render
  // before then. It calls the editor in the same step as it finds it, so a
  // removal can't come between them.
  const call = async <Result,>(
    method: (editor: AudioEditorHandle) => Result,
  ): Promise<Awaited<Result>> => {
    if (!now()) await ready;
    const editor = now();
    if (!editor) throw removed();
    return await method(editor);
  };
  return {
    update: render,
    unmount: () => {
      root.unmount();
      // Settles calls still waiting for a first render that won't come; after
      // one, it does nothing.
      rejectReady(removed());
      host.removeAttribute("data-hm-theme");
    },
    handle: {
      open: (file) => call((editor) => editor.open(file)),
      insert: (file, options) => call((editor) => editor.insert(file, options)),
      export: (options) => call((editor) => editor.export(options)),
      undo: () => now()?.undo(),
      redo: () => now()?.redo(),
      play: () => call((editor) => editor.play()),
      pause: () => now()?.pause(),
      seek: (frame) => now()?.seek(frame),
    },
  };
}
