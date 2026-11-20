import { defineTool } from "@hussmartinez/sdk-core";
import { type AudioPlan, clipAt, clipEnd } from "../../core/model/plan.js";
import { deleteRange } from "../range/range.js";
import type { AudioTool, AudioToolContext, AudioToolState, PlacedClip } from "../tools/types.js";

/**
 * The clip tools (docs/adr/0005, docs/adr/0006): split, delete, trim and
 * move, with the edits behind them. The toolbar's buttons, the editor's keys
 * and the timeline's drags and Alt keys all edit through the functions here,
 * so each path refuses and announces the same way.
 */

/** A clip of the plan by key, with its track. */
export function findClip(plan: AudioPlan, key: string): PlacedClip | undefined {
  for (const track of plan.tracks) {
    const clip = track.clips.find((each) => each.key === key);
    if (clip) return { clip, track };
  }
  return undefined;
}

/** Ten milliseconds in frames: what nudging keys and buttons move a clip or an edge by. */
export function nudgeFrames(plan: AudioPlan): number {
  return Math.max(1, Math.round(plan.sampleRate / 100));
}

/**
 * Whether clips can move `by` frames, and to `track` when it's given,
 * without starting before the timeline or overlapping a clip that stays.
 * The timeline asks it while a clip is dragged, so it reads the plan only.
 */
export function canPlace(
  plan: AudioPlan,
  keys: readonly string[],
  by: number,
  track?: string,
): boolean {
  if (track !== undefined && !plan.tracks.some((each) => each.key === track)) return false;
  const moving = new Set(keys);
  const spans = new Map<string, [number, number][]>();
  const add = (key: string, span: [number, number]) => {
    const list = spans.get(key);
    if (list) list.push(span);
    else spans.set(key, [span]);
  };
  for (const each of plan.tracks) {
    for (const clip of each.clips) {
      if (!moving.has(clip.key)) add(each.key, [clip.at, clipEnd(clip)]);
    }
  }
  for (const key of moving) {
    const placed = findClip(plan, key);
    if (!placed) return false;
    const at = placed.clip.at + by;
    if (at < 0) return false;
    add(track ?? placed.track.key, [at, at + clipEnd(placed.clip) - placed.clip.at]);
  }
  for (const list of spans.values()) {
    list.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < list.length; i++) {
      if ((list[i] as [number, number])[0] < (list[i - 1] as [number, number])[1]) return false;
    }
  }
  return true;
}

/**
 * How far a clip's edge can go, as a change in frames that's positive when
 * the clip grows at that edge: down to one frame long, and up to its
 * source's ends and its neighbours on the track.
 */
export function trimLimits(
  plan: AudioPlan,
  sourceFrames: (source: string) => number,
  key: string,
  edge: "start" | "end",
): { readonly min: number; readonly max: number } {
  const placed = findClip(plan, key);
  if (!placed) return { min: 0, max: 0 };
  const { clip, track } = placed;
  const index = track.clips.indexOf(clip);
  const min = -(clip.end - clip.start - 1);
  if (edge === "start") {
    const before = track.clips[index - 1];
    return { min, max: Math.min(clip.start, clip.at - (before ? clipEnd(before) : 0)) };
  }
  const after = track.clips[index + 1];
  const room = after ? after.at - clipEnd(clip) : Number.POSITIVE_INFINITY;
  return { min, max: Math.max(0, Math.min(sourceFrames(clip.source) - clip.end, room)) };
}

/** Moves clips along time, and to another track when one is named; says why it can't. */
export function moveClips(
  context: AudioToolContext,
  keys: readonly string[],
  by: number,
  track?: string,
): boolean {
  const { plan } = context.state;
  if (!plan || keys.length === 0) return false;
  // A move that would overlap is refused, and nothing is pushed aside (docs/adr/0006).
  if (!canPlace(plan, keys, by, track)) {
    context.announce({ key: "announce.noRoom" });
    return false;
  }
  const command = { type: "audio.moveClips" as const, keys, by };
  if (context.execute(track === undefined ? command : { ...command, track })) {
    context.announce({ key: "announce.refused" });
    return false;
  }
  return true;
}

/** Moves clips to the track above (-1) or below (1), at the same time, and keeps focus on them. */
export function moveClipsToTrack(
  context: AudioToolContext,
  keys: readonly string[],
  direction: -1 | 1,
): void {
  const { plan } = context.state;
  const first = keys[0];
  const placed = plan && first !== undefined ? findClip(plan, first) : undefined;
  if (!plan || !placed || first === undefined) return;
  const target = plan.tracks[plan.tracks.indexOf(placed.track) + direction];
  if (!target) return;
  if (moveClips(context, keys, 0, target.key)) {
    // After a move to another track, focus is on the moved clip (docs/adr/0006).
    context.focusClip(first);
    context.announce({ key: "announce.clipMovedTo", track: target });
  }
}

/** Changes a clip's edge by frames, positive to make the clip longer there. */
export function trimClip(
  context: AudioToolContext,
  key: string,
  edge: "start" | "end",
  delta: number,
): boolean {
  const { plan } = context.state;
  const placed = plan ? findClip(plan, key) : undefined;
  if (!plan || !placed || delta === 0) return false;
  const limits = trimLimits(plan, context.sourceFrames, key, edge);
  if (delta < limits.min || delta > limits.max) {
    context.announce({ key: "announce.noRoom" });
    return false;
  }
  const { clip } = placed;
  const refused = context.execute({
    type: "audio.trimClip",
    key,
    start: edge === "start" ? clip.start - delta : clip.start,
    end: edge === "end" ? clip.end + delta : clip.end,
  });
  if (refused) context.announce({ key: "announce.refused" });
  return refused === undefined;
}

/** Sets a clip's start or end to the playhead, and says its new range. */
export function trimClipToPlayhead(
  context: AudioToolContext,
  key: string,
  edge: "start" | "end",
): void {
  const { plan } = context.state;
  const placed = plan ? findClip(plan, key) : undefined;
  if (!placed) return;
  const frame = context.playhead();
  const { clip } = placed;
  const delta = edge === "start" ? clip.at - frame : frame - clipEnd(clip);
  if (delta === 0) return;
  if (trimClip(context, key, edge, delta)) {
    const at = edge === "start" ? frame : clip.at;
    const end = edge === "end" ? frame : clipEnd(clip);
    context.announce({ key: "announce.trimmed", frame: at, end });
  }
}

/** Splits the clip under the playhead, on the selected clip's track or the current one. */
function split(context: AudioToolContext): void {
  const track = context.state.clip?.track ?? context.state.track;
  if (!track) return;
  const frame = context.playhead();
  const clip = clipAt(track, frame);
  if (!clip || clip.at === frame) {
    context.announce({ key: "announce.noClipToSplit", track });
    return;
  }
  const newKey = context.newKey();
  if (context.execute({ type: "audio.splitClip", key: clip.key, at: frame, newKey })) {
    context.announce({ key: "announce.refused" });
    return;
  }
  // After a split, focus is on the part after the playhead (docs/adr/0005).
  context.focusClip(newKey);
  context.announce({ key: "announce.split", frame });
}

const editable = (state: AudioToolState) => state.plan !== undefined && !state.busy;
const withClip = (state: AudioToolState) => editable(state) && state.clip !== undefined;
const trackIndex = (state: AudioToolState) =>
  state.plan && state.clip ? state.plan.tracks.indexOf(state.clip.track) : -1;

/**
 * The clip tools, in the toolbar's order.
 *
 * @internal
 */
export const clipTools: readonly AudioTool[] = [
  /* @__PURE__ */ defineTool({
    id: "audio.split",
    label: "tools.split",
    icon: "split",
    group: "clips",
    shortcuts: ["S"],
    // Where the playhead is isn't state, so whether it's inside a clip is
    // known only when the tool runs, which says so when it isn't.
    isEnabled: (state: AudioToolState) =>
      editable(state) && (state.clip ?? state.track) !== undefined,
    run: split,
  }),
  /* @__PURE__ */ defineTool({
    id: "audio.delete",
    label: "tools.delete",
    icon: "delete",
    group: "clips",
    shortcuts: "delete",
    // The range, or else the selected clip (docs/adr/0005).
    isEnabled: (state: AudioToolState) =>
      withClip(state) || (editable(state) && state.selection !== undefined),
    run: (context: AudioToolContext) => {
      if (context.state.selection) {
        deleteRange(context);
        return;
      }
      const placed = context.state.clip;
      if (!placed) return;
      if (context.execute({ type: "audio.removeClips", keys: [placed.clip.key] })) {
        context.announce({ key: "announce.refused" });
        return;
      }
      // Focus on the clip moves as ui's clip track moves it: to the clip
      // that took its place, or the one before, or the playhead.
      context.announce({ key: "announce.clipDeleted" });
    },
  }),
  /* @__PURE__ */ defineTool({
    id: "audio.trim-start",
    label: "tools.trimStart",
    icon: "trim-start",
    group: "clips",
    shortcuts: ["["],
    isEnabled: withClip,
    run: (context: AudioToolContext) => {
      const placed = context.state.clip;
      if (placed) trimClipToPlayhead(context, placed.clip.key, "start");
    },
  }),
  /* @__PURE__ */ defineTool({
    id: "audio.trim-end",
    label: "tools.trimEnd",
    icon: "trim-end",
    group: "clips",
    shortcuts: ["]"],
    isEnabled: withClip,
    run: (context: AudioToolContext) => {
      const placed = context.state.clip;
      if (placed) trimClipToPlayhead(context, placed.clip.key, "end");
    },
  }),
  // Alt with the arrows moves a focused clip, through ui's clip track; these
  // are the buttons for a single pointer (WCAG 2.5.7).
  /* @__PURE__ */ defineTool({
    id: "audio.move-earlier",
    label: "tools.moveEarlier",
    icon: "chevron-left",
    group: "clips",
    isEnabled: (state: AudioToolState) => withClip(state) && (state.clip?.clip.at ?? 0) > 0,
    run: (context: AudioToolContext) => {
      const { plan, clip } = context.state;
      if (plan && clip) moveClips(context, [clip.clip.key], -nudgeFrames(plan));
    },
  }),
  /* @__PURE__ */ defineTool({
    id: "audio.move-later",
    label: "tools.moveLater",
    icon: "chevron-right",
    group: "clips",
    isEnabled: withClip,
    run: (context: AudioToolContext) => {
      const { plan, clip } = context.state;
      if (plan && clip) moveClips(context, [clip.clip.key], nudgeFrames(plan));
    },
  }),
  /* @__PURE__ */ defineTool({
    id: "audio.move-to-track-above",
    label: "tools.moveToTrackAbove",
    icon: "move-up",
    group: "clips",
    isEnabled: (state: AudioToolState) => withClip(state) && trackIndex(state) > 0,
    run: (context: AudioToolContext) => {
      const placed = context.state.clip;
      if (placed) moveClipsToTrack(context, [placed.clip.key], -1);
    },
  }),
  /* @__PURE__ */ defineTool({
    id: "audio.move-to-track-below",
    label: "tools.moveToTrackBelow",
    icon: "move-down",
    group: "clips",
    isEnabled: (state: AudioToolState) =>
      withClip(state) &&
      trackIndex(state) >= 0 &&
      trackIndex(state) < (state.plan?.tracks.length ?? 0) - 1,
    run: (context: AudioToolContext) => {
      const placed = context.state.clip;
      if (placed) moveClipsToTrack(context, [placed.clip.key], 1);
    },
  }),
];
