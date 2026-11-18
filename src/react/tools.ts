import type { ShortcutPart } from "@hussmartinez/sdk-core";
import { useAnnounce, usePlatform } from "@hussmartinez/ui/react";
import { useCallback, useMemo } from "react";
import type {
  AudioToolAnnouncement,
  AudioToolContext,
  AudioToolState,
} from "../features/tools/tools.js";
import { useAudioEditorContext, useAudioOutput, useAudioSession } from "./context.js";
import { trackName } from "./names.js";

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
  const { messages, tools, shortcuts, zoom, maxZoom, setZoom, currentTrack } = editor;
  const { session, snapshot } = useAudioSession();
  const { output, snapshot: playback } = useAudioOutput();
  const announce = useAnnounce();
  const platform = usePlatform();

  const { plan } = snapshot;
  const state = useMemo<AudioToolState>(
    () => ({
      plan,
      track: plan?.tracks.find((track) => track.key === currentTrack) ?? plan?.tracks[0],
      playing: playback.state === "playing",
      canUndo: snapshot.canUndo,
      canRedo: snapshot.canRedo,
      busy: snapshot.busy,
      zoom,
      maxZoom,
    }),
    [plan, currentTrack, playback, snapshot, zoom, maxZoom],
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

  const run = useCallback(
    (id: string) => {
      const tool = tools.get(id);
      if (!tool || (tool.isEnabled && !tool.isEnabled(state))) return false;
      const say = (message: AudioToolAnnouncement) => {
        if ("track" in message) {
          const index = plan?.tracks.indexOf(message.track) ?? 0;
          announce(messages.t(message.key, { track: trackName(messages, message.track, index) }));
        } else {
          announce(messages.t(message.key));
        }
      };
      const context: AudioToolContext = {
        state,
        execute: (commands) => {
          try {
            session.execute(commands);
          } catch {
            // A refused edit is shown by its error's text where the editor
            // shows errors; the plan is as it was.
          }
        },
        undo: () => session.undo(),
        redo: () => session.redo(),
        // A blocked play is the transport's to explain, by its button.
        play: () => void output.play().catch(() => {}),
        pause: () => output.pause(),
        seek: (frame) => output.seek(frame),
        setZoom,
        chooseFile: (purpose) => editor.fileChooser.current?.(purpose),
        newKey: () => session.createKey(),
        focusTrack: (key) => {
          editor.pendingFocus.current = key;
        },
        announce: say,
      };
      void tool.run(context);
      return true;
    },
    [tools, state, plan, session, output, setZoom, editor, announce, messages],
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
      ariaKeyShortcuts: (id: string) => shortcuts.ariaKeyShortcuts(id),
      labelWithKeys: (id: string) => {
        const tool = tools.get(id);
        const label = tool ? messages.t(tool.label as "tools.undo") : id;
        const [first] = shortcuts.describe(id);
        return first ? messages.t("toolbar.withKeys", { label, keys: describe(first) }) : label;
      },
    }),
    [flags, run, shortcuts, tools, messages, describe],
  );
}
