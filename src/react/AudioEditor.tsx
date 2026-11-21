import {
  AnnouncerProvider,
  type HeadingLevel,
  HeadingLevelProvider,
  UiMessagesProvider,
  useAnnounce,
} from "@hussmartinez/ui/react";
import {
  forwardRef,
  type ReactNode,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { AudioPlan } from "../core/model/plan.js";
import type { AudioRenderResult } from "../core/ports/audio-processor.js";
import type { AudioInsertOptions, AudioSessionExportOptions } from "../core/session/session.js";
import { AudioExportDialog, type AudioExportDialogProps } from "./AudioExportDialog.js";
import { EditorInspector } from "./AudioInspector.js";
import { Notices } from "./AudioNotices.js";
import { AudioRenameDialog } from "./AudioRenameDialog.js";
import { Stage } from "./AudioStage.js";
import { EditorToolbar } from "./AudioToolbar.js";
import { Transport } from "./AudioTransport.js";
import {
  AudioEditorProvider,
  type AudioEditorProviderProps,
  useAudioEditorContext,
  useAudioSession,
} from "./context.js";
import { ElementListenersContext } from "./element/listeners.js";
import { type AudioEditorPart, classes, type PartClassNames } from "./parts.js";
import { useAudioTools } from "./tools.js";

/** Tools whose keys are also a focused control's own, as Home and End are a list's. */
const CONTROL_KEYS: ReadonlySet<string> = new Set(["audio.start", "audio.end"]);

/** Whether a key's target is a control that uses Home and End itself. */
function ownsHomeAndEnd(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[role="listbox"],[role="toolbar"],[role="slider"],input,textarea,select') !==
      null
  );
}

/**
 * Props of {@link AudioEditor}: the provider's, and the editor's own.
 *
 * @public
 */
export interface AudioEditorProps extends Omit<AudioEditorProviderProps, "children"> {
  /** A recording opened when the editor mounts. */
  readonly initialFile?: Blob;
  /**
   * Called with the plan whenever it changes: when a recording opens or is
   * added, after every edit, and after undo and redo.
   */
  readonly onChange?: (plan: AudioPlan) => void;
  /**
   * The colour scheme, as `ui`'s `data-hm-theme`: `"light"`, `"dark"`, or
   * `"system"` to follow the device. Without it, the editor follows the
   * page's theme.
   */
  readonly theme?: "light" | "dark" | "system";
  /**
   * The level of the editor's headings, from 2 to 6, so they fit the
   * host's outline: the inspector's title, its one level of heading for now
   * (sdk-core ADR 0058). Defaults to 2. A value that isn't one of the five
   * is treated as 2, with a development warning.
   */
  readonly headingLevel?: HeadingLevel;
  /**
   * The name an export is downloaded under, without its extension, such as
   * the name of the file being edited. Without it, the recording's title is
   * used, or else `recording`. See {@link AudioExportDialogProps.fileName}.
   */
  readonly fileName?: string;
  /**
   * Takes an export's file instead of the download, such as to upload it or
   * save it the host's own way. The export dialog closes once it's called.
   * See {@link AudioExportDialogProps.onExport}.
   */
  readonly onExport?: (blob: Blob, result: AudioRenderResult) => void;
  /** Extra classes on the root. */
  readonly className?: string;
  /** Extra classes on the editor's parts. */
  readonly classNames?: Readonly<Partial<Record<AudioEditorPart, string>>>;
  /**
   * Leaves out the editor's own look: its layout and colours, and `ui`'s
   * `hm-text` on the root. `ui`'s components keep theirs.
   */
  readonly unstyled?: boolean;
}

/**
 * What a host can do with the editor through its ref.
 *
 * @public
 */
export interface AudioEditorHandle {
  /** Opens a recording, replacing the current one once it has opened. */
  open(file: Blob): Promise<void>;
  /** Adds a recording on a new track, or on `options.track`. */
  insert(file: Blob, options?: AudioInsertOptions): Promise<void>;
  undo(): void;
  redo(): void;
  play(): Promise<void>;
  pause(): void;
  /** Moves the playhead to a timeline frame. */
  seek(frame: number): void;
  /**
   * Exports the plan as it is now, for a host's own export button, without
   * the editor's dialog: through the editor's processor, or the host's
   * `processor`. It resolves with the file, the mix's peak and how many
   * frames were clamped, and never downloads anything or calls `onExport`.
   * It fails as `session.export` does, and throws `TypeError` when there's
   * no processor.
   */
  export(options?: AudioSessionExportOptions): Promise<AudioRenderResult>;
}

interface ShellProps {
  readonly initialFile: Blob | undefined;
  readonly onChange: ((plan: AudioPlan) => void) | undefined;
  readonly theme: AudioEditorProps["theme"];
  readonly headingLevel: HeadingLevel | undefined;
  readonly fileName: string | undefined;
  readonly onExport: ((blob: Blob, result: AudioRenderResult) => void) | undefined;
  readonly className: string | undefined;
  readonly classNames: PartClassNames | undefined;
  readonly unstyled: boolean;
}

const Shell = /* @__PURE__ */ forwardRef<AudioEditorHandle, ShellProps>(
  function Shell(props, ref): ReactNode {
    const { session, output, messages, open, insert } = useAudioEditorContext();

    useImperativeHandle(
      ref,
      () => ({
        open,
        insert,
        undo: () => session.undo(),
        redo: () => session.redo(),
        play: () => output.play(),
        pause: () => output.pause(),
        seek: (frame) => output.seek(frame),
        export: (options) => session.export(options),
      }),
      [session, output, open, insert],
    );

    const opened = useRef(false);
    useEffect(() => {
      if (opened.current || !props.initialFile) return;
      opened.current = true;
      // A failure is in the snapshot, which the stage shows.
      open(props.initialFile).catch(() => {});
    }, [props.initialFile, open]);

    return (
      // One Messages object for the SDK's text and ui's (sdk-core ADR 0046).
      <UiMessagesProvider messages={messages}>
        <AnnouncerProvider>
          <Root {...props} />
        </AnnouncerProvider>
      </UiMessagesProvider>
    );
  },
);

/** The editor's root, its regions in tab order, and what it says and where focus goes. */
function Root({
  onChange,
  theme,
  headingLevel,
  fileName,
  onExport,
  className,
  classNames,
  unstyled,
}: ShellProps): ReactNode {
  const { messages, playhead, shortcuts } = useAudioEditorContext();
  const { run } = useAudioTools();
  const { snapshot } = useAudioSession();
  // ui's announcer says this with the notices' warnings, which arrive in the same frame.
  const announce = useAnnounce();
  const play = useRef<HTMLButtonElement>(null);
  const { plan, sources } = snapshot;

  // The plan, to the host, whenever it changes.
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    if (plan) change.current?.(plan);
  }, [plan]);

  // A failure the editor shows is reported once, for the element's `error` event.
  const { onError } = useContext(ElementListenersContext);
  const { error } = snapshot;
  useEffect(() => {
    if (error) onError?.({ code: error.code, details: error.details ?? {} });
  }, [error, onError]);

  // A recording that opens, or one that's added, is announced; after an
  // open, focus goes to the timeline's playhead, so it never falls back to
  // the page (docs/adr/0005).
  const first = sources[0]?.id;
  const count = sources.length;
  const seen = useRef({ first, count });
  useEffect(() => {
    const before = seen.current;
    seen.current = { first, count };
    if (first !== undefined && first !== before.first) {
      announce(messages.t("editor.opened"));
      (playhead.current ?? play.current)?.focus();
    } else if (first !== undefined && count > before.count) {
      announce(messages.t("editor.inserted"));
    }
  }, [first, count, announce, messages, playhead]);

  return (
    <section
      // hm-text gives the editor's own text ui's type and colour, whatever
      // the host page sets around it (ui ADR 0010).
      className={classes(
        unstyled ? undefined : "hm-text",
        "hm-audio-editor",
        className,
        classNames?.root,
      )}
      aria-label={messages.t("editor.label")}
      data-hm-theme={theme}
      data-hm-unstyled={unstyled ? "" : undefined}
      onKeyDown={(event) => {
        // Shortcuts apply only while focus is in the editor, as WCAG 2.1.4
        // requires of single keys (sdk-core ADR 0030). The registry leaves
        // fields, dialogs and controls' own keys alone; Home and End are a
        // list's and a toolbar's own too (docs/adr/0005).
        const id = shortcuts.match(event.nativeEvent, { root: event.currentTarget });
        if (!id || (CONTROL_KEYS.has(id) && ownsHomeAndEnd(event.target))) return;
        if (run(id)) event.preventDefault();
      }}
    >
      <EditorToolbar classNames={classNames} />
      <Notices classNames={classNames} />
      {/* The inspector sits beside the stage and transport where there's room, and below them otherwise. */}
      <div className="hm-audio-editor-main">
        <div className="hm-audio-editor-work">
          <Stage classNames={classNames} />
          <Transport ref={play} classNames={classNames} />
        </div>
        {/* The editor's headings take their level from here (sdk-core ADR 0058). */}
        <HeadingLevelProvider level={headingLevel ?? 2}>
          <EditorInspector classNames={classNames} />
        </HeadingLevelProvider>
      </div>
      <AudioRenameDialog />
      <AudioExportDialog
        {...(fileName === undefined ? {} : { fileName })}
        {...(onExport === undefined ? {} : { onExport })}
      />
    </section>
  );
}

/**
 * The audio editor (docs/adr/0005, docs/adr/0006): a recording's tracks on
 * a timeline, with playback, over one editing session, entirely on the
 * device. It makes the SDK's own engine, processor and output for any you
 * don't pass.
 *
 * Load `ui`'s stylesheet, then this package's, once:
 *
 * @example
 * ```tsx
 * import "@hussmartinez/ui/styles.css";
 * import "@hussmartinez/audio-sdk/styles.css";
 * import { AudioEditor } from "@hussmartinez/audio-sdk/react";
 *
 * <AudioEditor initialFile={file} onChange={(plan) => save(plan)} />
 * ```
 *
 * @public
 */
export const AudioEditor = /* @__PURE__ */ forwardRef<AudioEditorHandle, AudioEditorProps>(
  function AudioEditor(
    {
      initialFile,
      onChange,
      theme,
      headingLevel,
      fileName,
      onExport,
      className,
      classNames,
      unstyled = false,
      ...provider
    },
    ref,
  ): ReactNode {
    return (
      <AudioEditorProvider {...provider}>
        <Shell
          ref={ref}
          initialFile={initialFile}
          onChange={onChange}
          theme={theme}
          headingLevel={headingLevel}
          fileName={fileName}
          onExport={onExport}
          className={className}
          classNames={classNames}
          unstyled={unstyled}
        />
      </AudioEditorProvider>
    );
  },
);
