import type { Tool } from "@hussmartinez/sdk-core";
import type { AudioClip, AudioPlan, AudioTrack } from "../../core/model/plan.js";
import type { AudioCommand, AudioCommandRejection } from "../../core/operations/commands.js";
import type { AudioSelection } from "../../core/session/session.js";

/**
 * A clip, with the track it's on.
 *
 * @internal
 */
export interface PlacedClip {
  readonly clip: AudioClip;
  readonly track: AudioTrack;
}

/**
 * What the editor's tools read to decide whether they're enabled or on
 * (docs/adr/0005, docs/adr/0006). It's derived from the session, the output
 * and the editor's view state, and rebuilt when any of them changes. It
 * never holds the playhead, which moves every frame while playing: a tool
 * that needs it reads it from its context when it runs.
 *
 * @internal
 */
export interface AudioToolState {
  readonly plan: AudioPlan | undefined;
  /** The track the track tools act on: the one focus was last in, or the first. */
  readonly track: AudioTrack | undefined;
  /** The selected clip, which the clip tools act on. */
  readonly clip: PlacedClip | undefined;
  /** The selected range of time, on some tracks, which Delete acts on first. */
  readonly selection: AudioSelection | undefined;
  /** Whether deleting a range closes the gap on its tracks (docs/adr/0006). */
  readonly ripple: boolean;
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
 * What a tool says when it's done, by message key: the editor words it,
 * with the track's name and the frame's time when it has them.
 *
 * @internal
 */
export interface AudioToolAnnouncement {
  readonly key:
    | "announce.undone"
    | "announce.redone"
    | "announce.trackAdded"
    | "announce.trackRemoved"
    | "announce.trackMoved"
    | "announce.muted"
    | "announce.unmuted"
    | "announce.split"
    | "announce.noClipToSplit"
    | "announce.clipDeleted"
    | "announce.clipMovedTo"
    | "announce.trimmed"
    | "announce.noRoom"
    | "announce.refused"
    | "announce.selected"
    | "announce.selectionCleared"
    | "announce.rangeDeleted"
    | "announce.rangeDeleted.ripple"
    | "announce.rippleOn"
    | "announce.rippleOff";
  readonly track?: AudioTrack;
  /** Tracks, said by name, or as every track. */
  readonly tracks?: readonly AudioTrack[];
  /** A frame of the timeline, said as a time. */
  readonly frame?: number;
  /** A second frame, for a range. */
  readonly end?: number;
}

/**
 * What a tool's `run` receives: the state it was enabled for, and the
 * editor's actions.
 *
 * @internal
 */
export interface AudioToolContext {
  readonly state: AudioToolState;
  /**
   * Runs commands as one undoable step. Returns why the session refused
   * them, `"failed"` for another failure, or `undefined` when they ran.
   */
  execute(
    commands: AudioCommand | readonly AudioCommand[],
  ): AudioCommandRejection | "failed" | undefined;
  undo(): void;
  redo(): void;
  play(): void;
  pause(): void;
  seek(frame: number): void;
  /** Where the playhead is now, in frames. */
  playhead(): number;
  /** Selects a range on tracks, every track without them, or clears the selection. */
  select(
    range:
      | { readonly start: number; readonly end: number; readonly tracks?: readonly string[] }
      | undefined,
  ): void;
  setRipple(on: boolean): void;
  /** Moves focus to the playhead, as after deleting a range. */
  focusPlayhead(): void;
  /** A source's length in frames, or 0 for one the session doesn't hold. */
  sourceFrames(source: string): number;
  setZoom(zoom: number): void;
  /** Opens the file chooser, to open a recording or to add one on a track of its own. */
  chooseFile(purpose: "open" | "insert"): void;
  /** A key for a new track or clip, from the session. */
  newKey(): string;
  /** Moves focus to a track's header once it renders, as after adding one. */
  focusTrack(key: string): void;
  /** Selects a clip and moves focus to it once it renders, as after a split. */
  focusClip(key: string): void;
  /** Says something politely, through the editor's announcer. */
  announce(message: AudioToolAnnouncement): void;
}

/**
 * One of the editor's tools.
 *
 * @internal
 */
export type AudioTool = Tool<AudioToolState, AudioToolContext>;
