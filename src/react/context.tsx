import {
  createMessages,
  createShortcutRegistry,
  createToolRegistry,
  type ShortcutRegistry,
  type ToolRegistry,
} from "@hussmartinez/sdk-core";
import { usePlatform } from "@hussmartinez/ui/react";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createAudioEngine } from "../adapters/audio-engine.js";
import { createAudioOutput } from "../adapters/audio-output.js";
import { createAudioProcessor } from "../adapters/audio-processor.js";
import { isAudioError } from "../core/errors/audio-error.js";
import type { AudioFilePolicyOverrides } from "../core/errors/audio-limits.js";
import type { AudioEngine } from "../core/ports/audio-engine.js";
import type { AudioOutput, AudioOutputSnapshot } from "../core/ports/audio-output.js";
import type { AudioProcessor } from "../core/ports/audio-processor.js";
import { connectOutput } from "../core/session/connect-output.js";
import {
  type AudioInsertOptions,
  type AudioSession,
  type AudioSessionEvent,
  type AudioSessionSnapshot,
  createAudioSession,
} from "../core/session/session.js";
import { watchPlayhead } from "../core/session/watch-playhead.js";
import { type AudioTool, audioTools, defaultAudioToolbar } from "../features/tools/tools.js";
import {
  type AudioEditorMessageOverrides,
  type AudioEditorMessages,
  audioEditorMessages,
} from "./editor-messages.js";

/**
 * Props of {@link AudioEditorProvider}.
 *
 * @public
 */
export interface AudioEditorProviderProps {
  /** Replaces the SDK's engine. You keep owning one you pass: the editor never destroys it. */
  readonly engine?: AudioEngine;
  /** Replaces the SDK's processor for exports. You keep owning it. */
  readonly processor?: AudioProcessor;
  /** Replaces the SDK's playback output. You keep owning it. */
  readonly output?: AudioOutput;
  /** The limits files and edits are checked against (docs/adr/0004). */
  readonly filePolicy?: AudioFilePolicyOverrides;
  /**
   * Where the application serves the package's `dist/assets/`, to self-host
   * the worker of the engine and the processor the editor makes.
   */
  readonly assetsUrl?: string | URL;
  /** Text overrides. */
  readonly messages?: AudioEditorMessageOverrides;
  /** The locale numbers, sizes and durations are formatted for. Defaults to `en`. */
  readonly locale?: string;
  /** Anonymous usage events: never file names, samples or metadata. */
  readonly onEvent?: (event: AudioSessionEvent) => void;
  /**
   * Which tools are present, by id, in order, such as
   * `["audio.undo", "audio.redo", "audio.add-track"]`. All of them by
   * default. A tool that's left out has no button and no shortcut.
   */
  readonly tools?: readonly string[];
  /**
   * The toolbar's groups, by tool id. By default: files, history, tracks
   * and zoom, from the present tools.
   */
  readonly toolbar?: readonly (readonly string[])[];
  readonly children?: ReactNode;
}

/**
 * A load in progress: an open or an insert, and how far it is.
 *
 * @public
 */
export interface AudioLoad {
  readonly kind: "open" | "insert";
  /** From 0 to 1. */
  readonly fraction: number;
}

interface EditorContext {
  readonly session: AudioSession;
  readonly output: AudioOutput;
  readonly messages: AudioEditorMessages;
  /** The open or insert in progress, which the editor shows with a Cancel button. */
  readonly load: AudioLoad | undefined;
  /** Opens a recording, replacing the current one. Rejects as `session.open` does. */
  readonly open: (file: Blob) => Promise<void>;
  /** Adds a recording, as `session.insert` does. */
  readonly insert: (file: Blob, options?: AudioInsertOptions) => Promise<void>;
  /** Stops the open or insert in progress. */
  readonly cancelLoad: () => void;
  /** The timeline's zoom, as a multiple of fitting the whole plan. */
  readonly zoom: number;
  readonly setZoom: (zoom: number) => void;
  /** The closest zoom the timeline allows at its width. */
  readonly maxZoom: number;
  readonly setMaxZoom: (zoom: number) => void;
  /** The selected clip's key: the one the clip tools and the inspector act on. */
  readonly selectedClip: string | undefined;
  readonly setSelectedClip: (key: string | undefined) => void;
  /** The timeline's playhead slider, where focus goes after a recording opens. */
  readonly playhead: RefObject<HTMLInputElement | null>;
  /** The track the track tools act on, by key: the one focus was last in. */
  readonly currentTrack: string | undefined;
  readonly setCurrentTrack: (key: string | undefined) => void;
  /**
   * A track whose header takes focus when it next renders, as after it's
   * added, and how its header says it has.
   */
  readonly pendingFocus: RefObject<string | undefined>;
  /** The present tools, and the toolbar's groups of them. */
  readonly tools: ToolRegistry<AudioTool>;
  /** The present tools' shortcuts, for this platform. */
  readonly shortcuts: ShortcutRegistry;
  /** Opens the toolbar's file chooser, when it's rendered. */
  readonly fileChooser: RefObject<((purpose: "open" | "insert") => void) | null>;
  /** The track being renamed, by key, while its dialog is open. */
  readonly renaming: string | undefined;
  readonly setRenaming: (key: string | undefined) => void;
}

const Context = createContext<EditorContext | null>(null);

/** The editor's context, or a `TypeError` naming the provider it needs. */
export function useAudioEditorContext(): EditorContext {
  const context = useContext(Context);
  if (!context) throw new TypeError("Audio editor components need an AudioEditorProvider.");
  return context;
}

/** What the provider made, and so must release. */
interface Owned {
  readonly session: AudioSession;
  readonly output: AudioOutput;
  release(): void;
}

/**
 * Makes the session and whatever adapters the host didn't pass. Nothing
 * starts: no worker until a file is read, and no `AudioContext` until the
 * first `play()`, so a render on a server, and StrictMode's extra render,
 * cost nothing.
 */
function make(props: AudioEditorProviderProps, onEvent: (event: AudioSessionEvent) => void): Owned {
  // A relative assetsUrl needs a page to resolve against; on a server the
  // engine is never used, so it's made without one there.
  const worker =
    props.assetsUrl !== undefined && typeof location !== "undefined"
      ? { assetsUrl: props.assetsUrl }
      : {};
  const made: { destroy(): Promise<void> }[] = [];
  const keep = <T extends { destroy(): Promise<void> }>(adapter: T): T => {
    made.push(adapter);
    return adapter;
  };
  const engine = props.engine ?? keep(createAudioEngine(worker));
  const processor = props.processor ?? keep(createAudioProcessor(worker));
  const output = props.output ?? keep(createAudioOutput());
  const session = createAudioSession({
    engine,
    processor,
    ...(props.filePolicy ? { filePolicy: props.filePolicy } : {}),
    onEvent,
  });
  return {
    session,
    output,
    release() {
      void session.close().finally(() => {
        // Only what the editor made: what a host passes stays theirs.
        for (const adapter of made) void adapter.destroy().catch(() => {});
      });
    },
  };
}

/**
 * Holds one editing session and its playback for the editor's parts
 * (docs/adr/0005): the session, the output kept in step with it by
 * `connectOutput`, and the editor's text. It makes the SDK's own engine,
 * processor and output for any you don't pass, and releases those when it
 * unmounts; ones you pass stay yours.
 *
 * StrictMode mounts twice in development: the release waits a moment, and a
 * second mount cancels it, so the editor keeps one session and at most one
 * `AudioContext`.
 *
 * @public
 */
export function AudioEditorProvider(props: AudioEditorProviderProps): ReactNode {
  const onEvent = useRef(props.onEvent);
  onEvent.current = props.onEvent;
  const [owned] = useState(() => make(props, (event) => onEvent.current?.(event)));
  const { session, output } = owned;

  // Released a moment after the last unmount, which a remount cancels.
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(pending.current);
    const disconnect = connectOutput(session, output);
    return () => {
      disconnect();
      pending.current = setTimeout(() => owned.release(), 0);
    };
  }, [owned, session, output]);

  const { locale, messages: overrides } = props;
  const messages = useMemo(
    () =>
      createMessages(audioEditorMessages, {
        ...(locale ? { locale } : {}),
        ...(overrides ? { overrides } : {}),
      }),
    [locale, overrides],
  );

  const [load, setLoad] = useState<AudioLoad>();
  const controller = useRef<AbortController | undefined>(undefined);
  const run = useCallback(
    async (kind: AudioLoad["kind"], work: (options: AudioInsertOptions) => Promise<void>) => {
      controller.current?.abort();
      const own = new AbortController();
      controller.current = own;
      setLoad({ kind, fraction: 0 });
      try {
        await work({
          signal: own.signal,
          onProgress: (fraction) => {
            if (controller.current === own) setLoad({ kind, fraction });
          },
        });
      } catch (error) {
        // A cancelled load isn't a failure to show; the session keeps any
        // other in its snapshot, for the editor to show.
        if (!isAudioError(error, "ABORTED")) throw error;
      } finally {
        if (controller.current === own) {
          controller.current = undefined;
          setLoad(undefined);
        }
      }
    },
    [],
  );
  const open = useCallback(
    (file: Blob) => run("open", (options) => session.open(file, options)),
    [run, session],
  );
  const insert = useCallback(
    (file: Blob, options: AudioInsertOptions = {}) =>
      run("insert", (progress) => session.insert(file, { ...options, ...progress })),
    [run, session],
  );
  const cancelLoad = useCallback(() => controller.current?.abort(), []);

  const [zoom, setZoom] = useState(1);
  const [maxZoom, setMaxZoom] = useState(1);
  const [selectedClip, setSelectedClip] = useState<string>();
  const playhead = useRef<HTMLInputElement>(null);
  const [currentTrack, setCurrentTrack] = useState<string>();
  const [renaming, setRenaming] = useState<string>();
  const pendingFocus = useRef<string | undefined>(undefined);
  const fileChooser = useRef<((purpose: "open" | "insert") => void) | null>(null);

  // The registries, from the tools and toolbar props, as plain data.
  const platform = usePlatform();
  const toolIds = JSON.stringify(props.tools ?? null);
  const toolbarIds = JSON.stringify(props.toolbar ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the props, by value.
  const tools = useMemo(
    () =>
      createToolRegistry(audioTools, {
        ...(props.tools ? { tools: props.tools } : {}),
        toolbar: (props.toolbar ?? defaultAudioToolbar).map((group) =>
          group.filter((id) => !props.tools || props.tools.includes(id)),
        ),
      }),
    [toolIds, toolbarIds],
  );
  const shortcuts = useMemo(
    () => createShortcutRegistry({ platform, tools: tools.tools }),
    [platform, tools],
  );

  const value = useMemo<EditorContext>(
    () => ({
      session,
      output,
      messages,
      load,
      open,
      insert,
      cancelLoad,
      zoom,
      setZoom,
      maxZoom,
      setMaxZoom,
      selectedClip,
      setSelectedClip,
      playhead,
      currentTrack,
      setCurrentTrack,
      pendingFocus,
      tools,
      shortcuts,
      fileChooser,
      renaming,
      setRenaming,
    }),
    [
      session,
      output,
      messages,
      load,
      open,
      insert,
      cancelLoad,
      zoom,
      maxZoom,
      selectedClip,
      currentTrack,
      tools,
      shortcuts,
      renaming,
    ],
  );
  return <Context.Provider value={value}>{props.children}</Context.Provider>;
}

/**
 * What {@link useAudioSession} gives.
 *
 * @public
 */
export interface UseAudioSessionResult {
  readonly session: AudioSession;
  readonly snapshot: AudioSessionSnapshot;
}

/**
 * The editor's session, and its snapshot, which re-renders the component on
 * every change. Inside an {@link AudioEditorProvider}.
 *
 * @public
 */
export function useAudioSession(): UseAudioSessionResult {
  const { session } = useAudioEditorContext();
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  return { session, snapshot };
}

/**
 * What {@link useAudioOutput} gives.
 *
 * @public
 */
export interface UseAudioOutputResult {
  readonly output: AudioOutput;
  readonly snapshot: AudioOutputSnapshot;
}

/**
 * The editor's playback output, and its snapshot: whether it's stopped,
 * playing or paused. Inside an {@link AudioEditorProvider}.
 *
 * @public
 */
export function useAudioOutput(): UseAudioOutputResult {
  const { output } = useAudioEditorContext();
  const snapshot = useSyncExternalStore(output.subscribe, output.getSnapshot, output.getSnapshot);
  return { output, snapshot };
}

/**
 * The playhead, in whole frames, through `watchPlayhead`: it re-renders the
 * component on animation frames while playing, and when the playhead jumps,
 * so only components that show the time pay for it. Inside an
 * {@link AudioEditorProvider}.
 *
 * @public
 */
export function useAudioPlayhead(): number {
  const { output } = useAudioEditorContext();
  const [frame, setFrame] = useState(() => output.position());
  useEffect(() => watchPlayhead(output, setFrame), [output]);
  return frame;
}

/**
 * The editor's text: the SDK's catalogue with `ui`'s and the host's
 * overrides. Inside an {@link AudioEditorProvider}.
 *
 * @public
 */
export function useAudioMessages(): AudioEditorMessages {
  return useAudioEditorContext().messages;
}
