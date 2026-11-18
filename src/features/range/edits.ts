import { defineTool } from "@hussmartinez/sdk-core";
import {
  type AudioClip,
  type AudioFade,
  type AudioPlan,
  clipEnd,
  NO_FADE,
} from "../../core/model/plan.js";
import type { AudioCommand } from "../../core/operations/commands.js";
import type { AudioSelection } from "../../core/session/session.js";
import type { AudioTool, AudioToolContext, AudioToolState } from "../tools/types.js";

/**
 * Editing what a range covers (docs/adr/0005): its clips are split at the
 * range's edges, and what's between is changed, as one undo step. Fades
 * and gain apply to the pieces inside the range; with no range, the fade
 * tools apply to the selected clip.
 */

/** A part of a clip inside a range, after the split: its key and what it will be. */
export interface RangePiece {
  readonly key: string;
  readonly track: string;
  readonly at: number;
  readonly end: number;
  readonly fadeIn: AudioFade;
  readonly fadeOut: AudioFade;
  readonly gainDb: number;
}

/** A clip-level fade's default length, when the fade tools apply to a clip: half a second. */
export const DEFAULT_FADE_SECONDS = 0.5;

/**
 * The commands that split a range's clips at its edges, on its tracks, and
 * the pieces inside it, in time order on each track. A split part after
 * the range's start takes no fade in, and a part before its end no fade
 * out, as `audio.splitClip` gives them.
 */
export function splitAtRange(
  plan: AudioPlan,
  selection: AudioSelection,
  newKey: () => string,
): { readonly commands: readonly AudioCommand[]; readonly pieces: readonly RangePiece[] } {
  const commands: AudioCommand[] = [];
  const pieces: RangePiece[] = [];
  const { start, end } = selection;
  for (const track of plan.tracks) {
    if (!selection.tracks.includes(track.key)) continue;
    for (const clip of track.clips) {
      const from = clip.at;
      const to = clipEnd(clip);
      if (to <= start || from >= end) continue;
      let key = clip.key;
      if (from < start) {
        const after = newKey();
        commands.push({ type: "audio.splitClip", key, at: start, newKey: after });
        key = after;
      }
      if (to > end) {
        commands.push({ type: "audio.splitClip", key, at: end, newKey: newKey() });
      }
      pieces.push({
        key,
        track: track.key,
        at: Math.max(from, start),
        end: Math.min(to, end),
        fadeIn: from < start ? NO_FADE : clip.fadeIn,
        fadeOut: to > end ? NO_FADE : clip.fadeOut,
        gainDb: clip.gainDb,
      });
    }
  }
  return { commands, pieces };
}

/** The clips a range covers on its tracks, before any split. */
export function clipsInRange(plan: AudioPlan, selection: AudioSelection): readonly AudioClip[] {
  return plan.tracks
    .filter((track) => selection.tracks.includes(track.key))
    .flatMap((track) =>
      track.clips.filter((clip) => clip.at < selection.end && clipEnd(clip) > selection.start),
    );
}

/**
 * Sets the gain of what a range covers, splitting its clips at its edges,
 * as one undo step.
 */
export function setRangeGain(context: AudioToolContext, gainDb: number): void {
  const { plan, selection } = context.state;
  if (!plan || !selection) return;
  const { commands, pieces } = splitAtRange(plan, selection, context.newKey);
  if (pieces.length === 0) {
    context.announce({ key: "announce.nothingInRange" });
    return;
  }
  const refused = context.execute([
    ...commands,
    { type: "audio.setGain", keys: pieces.map((piece) => piece.key), gainDb },
  ]);
  if (refused) {
    context.announce({ key: "announce.refused" });
    return;
  }
  context.announce({
    key: "announce.rangeGain",
    frame: selection.start,
    end: selection.end,
    tracks: plan.tracks.filter((track) => selection.tracks.includes(track.key)),
    gain: gainDb,
  });
}

/**
 * A fade over a range: on each of its tracks, the first piece inside it
 * fades in over its whole length, or the last fades out, after splitting
 * at the range's edges, as one undo step. A fade belongs to a clip, so a
 * range across several clips fades the one at its start or its end.
 */
function fadeRange(context: AudioToolContext, edge: "in" | "out"): void {
  const { plan, selection } = context.state;
  if (!plan || !selection) return;
  const { commands, pieces } = splitAtRange(plan, selection, context.newKey);
  const byTrack = new Map<string, RangePiece[]>();
  for (const piece of pieces)
    byTrack.set(piece.track, [...(byTrack.get(piece.track) ?? []), piece]);
  const fades: AudioCommand[] = [];
  for (const list of byTrack.values()) {
    const piece = edge === "in" ? list[0] : list[list.length - 1];
    if (!piece) continue;
    const own = edge === "in" ? piece.fadeIn : piece.fadeOut;
    const other = edge === "in" ? piece.fadeOut : piece.fadeIn;
    const frames = piece.end - piece.at - other.frames;
    if (frames > 0) {
      fades.push({ type: "audio.setFade", key: piece.key, edge, frames, curve: own.curve });
    }
  }
  if (fades.length === 0) {
    context.announce({ key: "announce.nothingInRange" });
    return;
  }
  if (context.execute([...commands, ...fades])) {
    context.announce({ key: "announce.refused" });
    return;
  }
  context.announce({
    key: edge === "in" ? "announce.fadedIn" : "announce.fadedOut",
    frame: selection.start,
    end: selection.end,
    tracks: plan.tracks.filter((track) => byTrack.has(track.key)),
  });
}

/** A fade on the selected clip, of the default length or as much as fits beside its other fade. */
function fadeClip(context: AudioToolContext, edge: "in" | "out"): void {
  const { plan, clip: placed } = context.state;
  if (!plan || !placed) return;
  const { clip } = placed;
  const own = edge === "in" ? clip.fadeIn : clip.fadeOut;
  const other = edge === "in" ? clip.fadeOut : clip.fadeIn;
  const frames = Math.min(
    Math.round(DEFAULT_FADE_SECONDS * plan.sampleRate),
    clip.end - clip.start - other.frames,
  );
  if (frames <= 0) {
    context.announce({ key: "announce.noRoomForFade" });
    return;
  }
  if (context.execute({ type: "audio.setFade", key: clip.key, edge, frames, curve: own.curve })) {
    context.announce({ key: "announce.refused" });
    return;
  }
  context.announce({
    key: edge === "in" ? "announce.clipFadedIn" : "announce.clipFadedOut",
    frame: frames,
  });
}

const canFade = (state: AudioToolState) =>
  state.plan !== undefined &&
  !state.busy &&
  (state.selection !== undefined || state.clip !== undefined);

/**
 * The fade tools: over the range when there is one, or on the selected clip
 * (docs/adr/0005).
 *
 * @internal
 */
export const fadeTools: readonly AudioTool[] = [
  defineTool({
    id: "audio.fade-in",
    label: "tools.fadeIn",
    icon: "fade-in",
    group: "clips",
    isEnabled: canFade,
    run: (context: AudioToolContext) =>
      context.state.selection ? fadeRange(context, "in") : fadeClip(context, "in"),
  }),
  defineTool({
    id: "audio.fade-out",
    label: "tools.fadeOut",
    icon: "fade-out",
    group: "clips",
    isEnabled: canFade,
    run: (context: AudioToolContext) =>
      context.state.selection ? fadeRange(context, "out") : fadeClip(context, "out"),
  }),
];
