import { defineTool } from "@hussmartinez/sdk-core";
import { planLength } from "../../core/model/plan.js";
import type { AudioTool, AudioToolContext, AudioToolState } from "../tools/types.js";

/**
 * Range selection (docs/adr/0005, docs/adr/0006): its edges at the
 * playhead with `I` and `O`, clearing it with Escape, and Ripple, which
 * decides whether deleting a range closes the gap on its tracks. Dragging
 * across the timeline and Shift with the playhead's keys select too, in the
 * timeline, through the same session.
 */

/** Selects from `start` to `end` on the selection's tracks, or every track, and says so. */
export function selectRange(context: AudioToolContext, start: number, end: number): void {
  const { plan, selection } = context.state;
  if (!plan || start >= end) return;
  const keys = selection?.tracks;
  context.select(keys ? { start, end, tracks: keys } : { start, end });
  const tracks = keys ? plan.tracks.filter((track) => keys.includes(track.key)) : plan.tracks;
  context.announce({ key: "announce.selected", frame: start, end, tracks });
}

/**
 * Deletes the selected range from its tracks, closing the gap when Ripple
 * is on, then puts the playhead and focus at its start (docs/adr/0005).
 */
export function deleteRange(context: AudioToolContext): void {
  const { plan, selection, ripple } = context.state;
  if (!plan || !selection) return;
  const { start, end } = selection;
  const refused = context.execute({
    type: "audio.deleteRange",
    start,
    end,
    tracks: selection.tracks,
    ripple,
  });
  if (refused) {
    context.announce({ key: "announce.refused" });
    return;
  }
  context.seek(start);
  context.focusPlayhead();
  context.announce({
    key: ripple ? "announce.rangeDeleted.ripple" : "announce.rangeDeleted",
    frame: start,
    end,
    tracks: plan.tracks.filter((track) => selection.tracks.includes(track.key)),
  });
}

const hasLength = (state: AudioToolState) => state.plan !== undefined && planLength(state.plan) > 0;

/**
 * The range tools, in the toolbar's order.
 *
 * @internal
 */
export const rangeTools: readonly AudioTool[] = [
  defineTool({
    id: "audio.set-start",
    label: "tools.setStart",
    icon: "range-start",
    group: "range",
    shortcuts: ["I"],
    isEnabled: hasLength,
    // From the playhead to the selection's end, or to the end of the plan.
    run: (context: AudioToolContext) => {
      const { plan, selection } = context.state;
      if (!plan) return;
      const frame = context.playhead();
      const end = selection && selection.end > frame ? selection.end : planLength(plan);
      selectRange(context, frame, end);
    },
  }),
  defineTool({
    id: "audio.set-end",
    label: "tools.setEnd",
    icon: "range-end",
    group: "range",
    shortcuts: ["O"],
    isEnabled: hasLength,
    // From the selection's start, or the start of the plan, to the playhead.
    run: (context: AudioToolContext) => {
      const { selection } = context.state;
      const frame = context.playhead();
      const start = selection && selection.start < frame ? selection.start : 0;
      selectRange(context, start, frame);
    },
  }),
  defineTool({
    id: "audio.clear-selection",
    label: "tools.clearSelection",
    icon: "close",
    group: "range",
    shortcuts: "cancel",
    // Only with a selection, so Escape is free for anything else otherwise.
    isEnabled: (state: AudioToolState) => state.selection !== undefined,
    run: (context: AudioToolContext) => {
      context.select(undefined);
      context.announce({ key: "announce.selectionCleared" });
    },
  }),
  defineTool({
    id: "audio.ripple",
    label: "tools.ripple",
    icon: "ripple",
    group: "range",
    isEnabled: (state: AudioToolState) => state.plan !== undefined,
    isActive: (state: AudioToolState) => state.ripple,
    run: (context: AudioToolContext) => {
      context.setRipple(!context.state.ripple);
      context.announce({ key: context.state.ripple ? "announce.rippleOff" : "announce.rippleOn" });
    },
  }),
];
