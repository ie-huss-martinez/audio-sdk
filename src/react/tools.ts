import { isSdkError, type ShortcutPart } from "@hussmartinez/sdk-core";
import { useAnnounce, usePlatform } from "@hussmartinez/ui/react";
import { useCallback, useMemo } from "react";
import { formatTimecode } from "../core/model/time.js";
import type { AudioCommandRejection } from "../core/operations/commands.js";
import { findClip } from "../features/clips/clips.js";
import type {
  AudioToolAnnouncement,
  AudioToolContext,
  AudioToolState,
} from "../features/tools/types.js";
import { useAudioEditorContext, useAudioOutput, useAudioSession } from "./context.js";
import { trackName, tracksText } from "./names.js";

/** Whether a tool can run now, and whether a toggle is on. */
export interface ToolFlags {
  readonly enabled: boolean;
  readonly active: boolean;
}

/** What the toolbar, the headers and the editor's keys use to run tools. */
export interface AudioTools {
  /** Each present tool's flags, by id. */
  readonly flags: ReadonlyMap<string, ToolFlags>;
  /** Runs a tool, if it's present and enabled now. Returns whether it ran. */
  run(id: string): boolean;
  /** The context tools run with, for the timeline's drags and keys, which edit as tools do. */
  context(): AudioToolContext;
  /** A tool's shortcuts, for `aria-keyshortcuts`. */
  ariaKeyShortcuts(id: string): string | undefined;
  /** A tool's label with its first shortcut, such as "Undo (Ctrl+Z)", for its tooltip. */
  labelWithKeys(id: string): string;
}

/**
 * The editor's tools, bound to its session, output and view (docs/adr/0005).
 * None of them depends on the playhead, so their flags follow the session's
 * and the output's snapshots, and the view, without polling.
 *
 * @internal
 */
export function useAudioTools(): AudioTools {
  const editor = useAudioEditorContext();
  const { messages, tools, shortcuts, zoom, maxZoom, setZoom, currentTrack, selectedClip, ripple } =
    editor;
  const { session, snapshot } = useAudioSession();
  const { output, snapshot: playback } = useAudioOutput();
  const announce = useAnnounce();
  const platform = usePlatform();

  const { plan, sources } = snapshot;
  const state = useMemo<AudioToolState>(
    () => ({
      plan,
      track: plan?.tracks.find((track) => track.key === currentTrack) ?? plan?.tracks[0],
      clip: plan && selectedClip !== undefined ? findClip(plan, selectedClip) : undefined,
      selection: snapshot.selection,
      ripple,
      playing: playback.state === "playing",
      canUndo: snapshot.canUndo,
      canRedo: snapshot.canRedo,
      busy: snapshot.busy,
      zoom,
      maxZoom,
    }),
    [plan, currentTrack, selectedClip, ripple, playback, snapshot, zoom, maxZoom],
  );
  const flags = useMemo(
    () =>
      new Map(
        tools.tools.map((tool) => [
          tool.id,
          { enabled: tool.isEnabled?.(state) ?? true, active: tool.isActive?.(state) ?? false },
        ]),
      ),
    [tools, state],
  );

  const context = useCallback((): AudioToolContext => {
    const frames = new Map(sources.map((source) => [source.id, source.frames]));
    const say = (message: AudioToolAnnouncement) => {
      const index = message.track && plan ? plan.tracks.indexOf(message.track) : 0;
      const rate = plan?.sampleRate ?? 1;
      announce(
        // Each message uses the parameters it names, and ignores the rest.
        messages.t(
          message.key as "announce.trimmed",
          {
            track: message.track ? trackName(messages, message.track, index) : "",
            time: message.frame === undefined ? "" : formatTimecode(message.frame, rate),
            end: message.end === undefined ? "" : formatTimecode(message.end, rate),
            tracks: message.tracks ? tracksText(messages, plan, message.tracks) : "",
            gain: message.gain ?? 0,
          } as { time: string; end: string; tracks: string; gain: number },
        ),
      );
    };
    return {
      state,
      execute: (commands) => {
        try {
          session.execute(commands);
          return undefined;
        } catch (error) {
          // A refused edit leaves the plan as it was; the tool says so.
          if (isSdkError(error) && error.code === "INVALID_COMMAND") {
            const reason = (error.details as { reason?: AudioCommandRejection } | undefined)
              ?.reason;
            return reason ?? "failed";
          }
          return "failed";
        }
      },
      undo: () => session.undo(),
      redo: () => session.redo(),
      // A blocked play is the transport's to explain, by its button.
      play: () => void output.play().catch(() => {}),
      pause: () => output.pause(),
      seek: (frame) => output.seek(frame),
      playhead: () => output.position(),
      select: (range) => session.select(range),
      setRipple: editor.setRipple,
      focusPlayhead: () => editor.playhead.current?.focus(),
      openDialog: (dialog) => editor.setDialog(dialog),
      sourceFrames: (source) => frames.get(source) ?? 0,
      setZoom,
      chooseFile: (purpose) => editor.fileChooser.current?.(purpose),
      newKey: () => session.createKey(),
      focusTrack: (key) => {
        editor.pendingFocus.current = key;
      },
      focusClip: (key) => {
        editor.pendingClipFocus.current = key;
        editor.setSelectedClip(key);
      },
      announce: say,
    };
  }, [state, plan, sources, session, output, setZoom, editor, announce, messages]);

  const run = useCallback(
    (id: string) => {
      const tool = tools.get(id);
      if (!tool || (tool.isEnabled && !tool.isEnabled(state))) return false;
      void tool.run(context());
      return true;
    },
    [tools, state, context],
  );

  const describe = useCallback(
    (parts: readonly ShortcutPart[]) =>
      parts
        .map((part) => (part.message ? messages.t(part.message as "keys.control") : part.value))
        // Apple writes chords without separators: Command, Shift and Z run together.
        .join(platform === "apple" ? "" : "+"),
    [messages, platform],
  );

  return useMemo(
    () => ({
      flags,
      run,
      context,
      ariaKeyShortcuts: (id: string) => shortcuts.ariaKeyShortcuts(id),
      labelWithKeys: (id: string) => {
        const tool = tools.get(id);
        const label = tool ? messages.t(tool.label as "tools.undo") : id;
        const [first] = shortcuts.describe(id);
        return first ? messages.t("toolbar.withKeys", { label, keys: describe(first) }) : label;
      },
    }),
    [flags, run, context, shortcuts, tools, messages, describe],
  );
}
