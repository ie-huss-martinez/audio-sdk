import { defineTool, type Tool } from "@hussmartinez/sdk-core";
import { type AudioPlan, type AudioTrack, planLength } from "../../core/model/plan.js";
import type { AudioCommand } from "../../core/operations/commands.js";

/**
 * What the editor's tools read to decide whether they're enabled or on
 * (docs/adr/0005, docs/adr/0006). It's derived from the session, the output
 * and the editor's view state, and rebuilt when any of them changes.
 *
 * @internal
 */
export interface AudioToolState {
  readonly plan: AudioPlan | undefined;
  /** The track the track tools act on: the one focus was last in, or the first. */
  readonly track: AudioTrack | undefined;
  readonly playing: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Whether a recording is being opened or added. */
  readonly busy: boolean;
  /** The timeline's zoom, as a multiple of fitting the whole plan: 1 fits it. */
  readonly zoom: number;
  /** The closest zoom the timeline allows now. */
  readonly maxZoom: number;
}

/**
 * What a tool's `run` receives: the state it was enabled for, and the
 * editor's actions.
 *
 * @internal
 */
export interface AudioToolContext {
  readonly state: AudioToolState;
  /** Runs commands as one undoable step. A refused edit shows by its error's text. */
  execute(commands: AudioCommand | readonly AudioCommand[]): void;
  undo(): void;
  redo(): void;
  play(): void;
  pause(): void;
  seek(frame: number): void;
  setZoom(zoom: number): void;
  /** Opens the file chooser, to open a recording or to add one on a track of its own. */
  chooseFile(purpose: "open" | "insert"): void;
  /** A key for a new track, from the session. */
  newKey(): string;
  /** Moves focus to a track's header once it renders, as after adding one. */
  focusTrack(key: string): void;
  /** Says something politely, through the editor's announcer. */
  announce(message: AudioToolAnnouncement): void;
}

/**
 * What a tool says when it's done, by message key: the editor words it.
 *
 * @internal
 */
export type AudioToolAnnouncement =
  | { readonly key: "announce.undone" | "announce.redone" | "announce.trackAdded" }
  | {
      readonly key:
        | "announce.trackRemoved"
        | "announce.muted"
        | "announce.unmuted"
        | "announce.trackMoved";
      readonly track: AudioTrack;
    };

/**
 * One of the editor's tools.
 *
 * @internal
 */
export type AudioTool = Tool<AudioToolState, AudioToolContext>;

/** Each zoom step multiplies or divides the timeline's zoom by this. */
export const ZOOM_STEP = 2;

const length = (state: AudioToolState) => (state.plan ? planLength(state.plan) : 0);
const trackIndex = (state: AudioToolState) =>
  state.plan && state.track ? state.plan.tracks.indexOf(state.track) : -1;
const editable = (state: AudioToolState) => state.plan !== undefined && !state.busy;

/**
 * Every tool the audio editor knows, in order (docs/adr/0005). The editor
 * builds its toolbar and its shortcuts from them, with sdk-core's registries.
 *
 * @internal
 */
export const audioTools: readonly AudioTool[] = [
  defineTool({
    id: "audio.open",
    label: "tools.open",
    icon: "open",
    group: "file",
    // Mod+O is the browser's own (docs/adr/0005).
    run: (context: AudioToolContext) => context.chooseFile("open"),
  }),
  defineTool({
    id: "audio.insert",
    label: "tools.insert",
    icon: "upload",
    group: "file",
    isEnabled: editable,
    run: (context: AudioToolContext) => context.chooseFile("insert"),
  }),
  defineTool({
    id: "audio.undo",
    label: "tools.undo",
    icon: "undo",
    group: "history",
    shortcuts: "undo",
    isEnabled: (state: AudioToolState) => state.canUndo && !state.busy,
    run: (context: AudioToolContext) => {
      context.undo();
      context.announce({ key: "announce.undone" });
    },
  }),
  defineTool({
    id: "audio.redo",
    label: "tools.redo",
    icon: "redo",
    group: "history",
    shortcuts: "redo",
    isEnabled: (state: AudioToolState) => state.canRedo && !state.busy,
    run: (context: AudioToolContext) => {
      context.redo();
      context.announce({ key: "announce.redone" });
    },
  }),
  defineTool({
    id: "audio.add-track",
    label: "tools.addTrack",
    icon: "add",
    group: "tracks",
    isEnabled: editable,
    run: (context: AudioToolContext) => {
      const key = context.newKey();
      // Below the current track, or at the bottom.
      const index = trackIndex(context.state) + 1 || (context.state.plan?.tracks.length ?? 0);
      context.execute({ type: "audio.addTrack", key, index });
      context.focusTrack(key);
      context.announce({ key: "announce.trackAdded" });
    },
  }),
  defineTool({
    id: "audio.remove-track",
    label: "tools.removeTrack",
    icon: "remove",
    group: "tracks",
    // A plan keeps at least one track (docs/adr/0006).
    isEnabled: (state: AudioToolState) =>
      editable(state) && state.track !== undefined && (state.plan?.tracks.length ?? 0) > 1,
    run: (context: AudioToolContext) => {
      const { plan, track } = context.state;
      if (!plan || !track) return;
      const index = plan.tracks.indexOf(track);
      context.execute({ type: "audio.removeTracks", keys: [track.key] });
      // The track that took its place, or the one above (docs/adr/0006).
      const next = plan.tracks[index + 1] ?? plan.tracks[index - 1];
      if (next) context.focusTrack(next.key);
      context.announce({ key: "announce.trackRemoved", track });
    },
  }),
  defineTool({
    id: "audio.move-track-up",
    label: "tools.moveTrackUp",
    icon: "move-up",
    group: "tracks",
    isEnabled: (state: AudioToolState) => editable(state) && trackIndex(state) > 0,
    run: (context: AudioToolContext) => {
      const { track } = context.state;
      if (!track) return;
      context.execute({
        type: "audio.moveTrack",
        key: track.key,
        to: trackIndex(context.state) - 1,
      });
      context.focusTrack(track.key);
      context.announce({ key: "announce.trackMoved", track });
    },
  }),
  defineTool({
    id: "audio.move-track-down",
    label: "tools.moveTrackDown",
    icon: "move-down",
    group: "tracks",
    isEnabled: (state: AudioToolState) =>
      editable(state) &&
      trackIndex(state) >= 0 &&
      trackIndex(state) < (state.plan?.tracks.length ?? 0) - 1,
    run: (context: AudioToolContext) => {
      const { track } = context.state;
      if (!track) return;
      context.execute({
        type: "audio.moveTrack",
        key: track.key,
        to: trackIndex(context.state) + 1,
      });
      context.focusTrack(track.key);
      context.announce({ key: "announce.trackMoved", track });
    },
  }),
  defineTool({
    id: "audio.mute",
    label: "tools.mute",
    icon: "muted",
    group: "tracks",
    shortcuts: ["M"],
    isEnabled: (state: AudioToolState) => editable(state) && state.track !== undefined,
    isActive: (state: AudioToolState) => state.track?.muted ?? false,
    run: (context: AudioToolContext) => {
      const { track } = context.state;
      if (!track) return;
      context.execute({ type: "audio.setTrack", key: track.key, muted: !track.muted });
      context.announce({ key: track.muted ? "announce.unmuted" : "announce.muted", track });
    },
  }),
  defineTool({
    id: "audio.zoom-out",
    label: "tools.zoomOut",
    icon: "zoom-out",
    group: "view",
    shortcuts: "zoom-out",
    isEnabled: (state: AudioToolState) => state.plan !== undefined && state.zoom > 1,
    run: (context: AudioToolContext) =>
      context.setZoom(Math.max(1, context.state.zoom / ZOOM_STEP)),
  }),
  defineTool({
    id: "audio.zoom-in",
    label: "tools.zoomIn",
    icon: "zoom-in",
    group: "view",
    shortcuts: "zoom-in",
    isEnabled: (state: AudioToolState) => state.plan !== undefined && state.zoom < state.maxZoom,
    run: (context: AudioToolContext) =>
      context.setZoom(Math.min(context.state.maxZoom, context.state.zoom * ZOOM_STEP)),
  }),
  defineTool({
    id: "audio.zoom-fit",
    label: "tools.zoomFit",
    icon: "fit",
    group: "view",
    shortcuts: "zoom-reset",
    isEnabled: (state: AudioToolState) => state.plan !== undefined && state.zoom !== 1,
    run: (context: AudioToolContext) => context.setZoom(1),
  }),
  // The transport's, with keys: not in the toolbar.
  defineTool({
    id: "audio.play-pause",
    label: "tools.playPause",
    icon: "play",
    group: "playback",
    shortcuts: "play-pause",
    isEnabled: (state: AudioToolState) => length(state) > 0,
    run: (context: AudioToolContext) => (context.state.playing ? context.pause() : context.play()),
  }),
  defineTool({
    id: "audio.start",
    label: "tools.start",
    icon: "skip-back",
    group: "playback",
    shortcuts: ["Home"],
    isEnabled: (state: AudioToolState) => length(state) > 0,
    run: (context: AudioToolContext) => context.seek(0),
  }),
  defineTool({
    id: "audio.end",
    label: "tools.end",
    icon: "skip-forward",
    group: "playback",
    shortcuts: ["End"],
    isEnabled: (state: AudioToolState) => length(state) > 0,
    run: (context: AudioToolContext) => context.seek(length(context.state)),
  }),
];

/**
 * The toolbar's groups by default, by tool id: files, history, tracks and
 * zoom. The transport has playback, and track headers have Mute.
 *
 * @internal
 */
export const defaultAudioToolbar: readonly (readonly string[])[] = [
  ["audio.open", "audio.insert"],
  ["audio.undo", "audio.redo"],
  ["audio.add-track", "audio.remove-track", "audio.move-track-up", "audio.move-track-down"],
  ["audio.zoom-out", "audio.zoom-in", "audio.zoom-fit"],
];
