import { AnnouncerProvider, UiMessagesProvider, useAnnounce } from "@hussmartinez/ui/react";
import { forwardRef, type ReactNode, useEffect, useImperativeHandle, useRef } from "react";
import type { AudioPlan } from "../core/model/plan.js";
import type { AudioInsertOptions } from "../core/session/session.js";
import { Notices } from "./AudioNotices.js";
import { Stage } from "./AudioStage.js";
import { Transport } from "./AudioTransport.js";
import {
  AudioEditorProvider,
  type AudioEditorProviderProps,
  useAudioEditorContext,
  useAudioSession,
} from "./context.js";
import { type AudioEditorPart, classes, type PartClassNames } from "./parts.js";

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
}

interface ShellProps {
  readonly initialFile: Blob | undefined;
  readonly onChange: ((plan: AudioPlan) => void) | undefined;
  readonly theme: AudioEditorProps["theme"];
  readonly className: string | undefined;
  readonly classNames: PartClassNames | undefined;
  readonly unstyled: boolean;
}

const Shell = forwardRef<AudioEditorHandle, ShellProps>(function Shell(props, ref): ReactNode {
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
});

/** The editor's root, its regions in tab order, and what it says and where focus goes. */
function Root({ onChange, theme, className, classNames, unstyled }: ShellProps): ReactNode {
  const { messages, playhead } = useAudioEditorContext();
  const { snapshot } = useAudioSession();
  const announce = useAnnounce();
  const play = useRef<HTMLButtonElement>(null);
  const { plan, sources } = snapshot;

  // The plan, to the host, whenever it changes.
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    if (plan) change.current?.(plan);
  }, [plan]);

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
    >
      <Notices classNames={classNames} />
      <Stage classNames={classNames} />
      <Transport ref={play} classNames={classNames} />
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
    { initialFile, onChange, theme, className, classNames, unstyled = false, ...provider },
    ref,
  ): ReactNode {
    return (
      <AudioEditorProvider {...provider}>
        <Shell
          ref={ref}
          initialFile={initialFile}
          onChange={onChange}
          theme={theme}
          className={className}
          classNames={classNames}
          unstyled={unstyled}
        />
      </AudioEditorProvider>
    );
  },
);
