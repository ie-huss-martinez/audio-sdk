import { TimelineLayer, useTimelineLanes, useTimelineScale } from "@hussmartinez/ui/react";
import { type PointerEvent, type ReactNode, useRef } from "react";
import type { AudioSelection } from "../core/session/session.js";
import { useAudioEditorContext } from "./context.js";

/** How far a pointer moves, in CSS pixels, before a press becomes a drag. */
const DRAG_THRESHOLD = 4;

interface Press {
  readonly id: number;
  readonly x: number;
  readonly unit: number;
  readonly lane: string | undefined;
  readonly touch: boolean;
  lastLane: string | undefined;
  dragging: boolean;
}

/**
 * Selecting a range of time with a pointer (docs/adr/0005, docs/adr/0006):
 * dragging across the timeline selects the range under it, snapping as the
 * timeline does unless Alt is held, on the lanes the drag crosses. A press
 * without a drag moves the playhead there and clears the selection. On a
 * touch screen a drag scrolls, so only a tap counts; the toolbar's Start
 * and End buttons select there.
 *
 * It's a layer under the lanes, written before them: `ui`'s lanes let a
 * press through to it on their empty space and on a clip's body, and keep
 * their headers', clips' titles' and edges' presses (ui 0.14).
 */
export function RangeGestures(): ReactNode {
  const { session, output } = useAudioEditorContext();
  const scale = useTimelineScale();
  const { lanes, laneAt } = useTimelineLanes();
  const press = useRef<Press | undefined>(undefined);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || press.current || scale.pixelsPerUnit === 0) return;
    const lane = laneAt(event.clientY);
    const touch = event.pointerType === "touch";
    press.current = {
      id: event.pointerId,
      x: event.clientX,
      unit: scale.unitAt(event.clientX, { snap: !event.altKey }),
      lane,
      touch,
      lastLane: lane,
      dragging: false,
    };
    if (!touch) {
      // Keeps the drag ours past the timeline's edge, and the page's text
      // unselected. Capture fails for a pointer that's already gone, and
      // the drag still works while the pointer stays over the timeline.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {}
      event.preventDefault();
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = press.current;
    if (!current || event.pointerId !== current.id || current.touch) return;
    if (!current.dragging && Math.abs(event.clientX - current.x) < DRAG_THRESHOLD) return;
    current.dragging = true;
    current.lastLane = laneAt(event.clientY) ?? current.lastLane;
    const unit = scale.unitAt(event.clientX, { snap: !event.altKey });
    const from = current.lane === undefined ? -1 : lanes.indexOf(current.lane);
    const to = current.lastLane === undefined ? -1 : lanes.indexOf(current.lastLane);
    const tracks =
      from < 0 || to < 0 ? undefined : lanes.slice(Math.min(from, to), Math.max(from, to) + 1);
    session.select({
      start: Math.min(current.unit, unit),
      end: Math.max(current.unit, unit),
      ...(tracks ? { tracks } : {}),
    });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const done = press.current;
    if (!done || event.pointerId !== done.id) return;
    press.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (done.dragging) return;
    // A touch that moved was a scroll.
    if (done.touch && Math.abs(event.clientX - done.x) >= DRAG_THRESHOLD) return;
    output.seek(done.unit);
    session.select(undefined);
  };

  const onPointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (press.current && event.pointerId === press.current.id) press.current = undefined;
  };

  return (
    <TimelineLayer
      className="hm-audio-editor-press-layer"
      aria-hidden="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    />
  );
}

/** The selected range on one lane, drawn under its clips. */
export function RangeMark({ selection }: { readonly selection: AudioSelection }): ReactNode {
  const { toPixels } = useTimelineScale();
  const start = toPixels(selection.start);
  return (
    <div
      className="hm-audio-editor-range"
      style={{ insetInlineStart: `${start}px`, inlineSize: `${toPixels(selection.end) - start}px` }}
    />
  );
}
