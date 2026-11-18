import { useTimelineLanes, useTimelineScale } from "@hussmartinez/ui/react";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import type { AudioSelection } from "../core/session/session.js";
import { useAudioEditorContext } from "./context.js";

/**
 * What a press on the track leaves to its own controls: a clip's title
 * and edges, which drag it, the lanes' headers and the playhead's slider.
 */
const CONTROLS =
  ".hm-timeline-clip-content, .hm-timeline-clip-edge, .hm-timeline-lane-header, " +
  ".hm-timeline-bar, .hm-timeline-corner, button, input";

/** How far a pointer moves, in CSS pixels, before a press becomes a drag. */
const DRAG_THRESHOLD = 4;

/**
 * Selecting a range of time with a pointer (docs/adr/0005, docs/adr/0006):
 * dragging across the timeline selects the range under it, snapping as the
 * timeline does unless Alt is held, on the lanes the drag crosses. A press
 * without a drag moves the playhead there and clears the selection. On a
 * touch screen a drag scrolls, so only a tap counts; the toolbar's Start
 * and End buttons select there.
 *
 * It renders nothing: it listens on the timeline's track, inside the
 * timeline so it can use its scale and lanes.
 */
export function RangeGestures({
  timeline,
}: {
  readonly timeline: RefObject<HTMLElement | null>;
}): ReactNode {
  const { session, output } = useAudioEditorContext();
  const scale = useTimelineScale();
  const { lanes, laneAt } = useTimelineLanes();
  // The latest of each, for listeners added once.
  const latest = useRef({ scale, lanes, laneAt, session, output });
  latest.current = { scale, lanes, laneAt, session, output };

  useEffect(() => {
    const track = timeline.current?.querySelector<HTMLElement>(".hm-timeline-track");
    if (!track) return;
    let press:
      | {
          readonly id: number;
          readonly x: number;
          readonly unit: number;
          readonly lane: string | undefined;
          readonly touch: boolean;
          lastLane: string | undefined;
          dragging: boolean;
        }
      | undefined;

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || press) return;
      if (event.target instanceof Element && event.target.closest(CONTROLS)) return;
      const { scale: now, laneAt: at } = latest.current;
      if (now.pixelsPerUnit === 0) return;
      const lane = at(event.clientY);
      const touch = event.pointerType === "touch";
      press = {
        id: event.pointerId,
        x: event.clientX,
        unit: now.unitAt(event.clientX, { snap: !event.altKey }),
        lane,
        touch,
        lastLane: lane,
        dragging: false,
      };
      if (!touch) {
        // Keeps the drag ours past the track's edge, and the page's text
        // unselected. Capture fails for a pointer that's already gone, and
        // the drag still works while the pointer stays over the track.
        try {
          track.setPointerCapture(event.pointerId);
        } catch {}
        event.preventDefault();
      }
    };

    const onMove = (event: PointerEvent) => {
      if (!press || event.pointerId !== press.id || press.touch) return;
      if (!press.dragging && Math.abs(event.clientX - press.x) < DRAG_THRESHOLD) return;
      press.dragging = true;
      const { scale: now, lanes: ids, laneAt: at, session: current } = latest.current;
      press.lastLane = at(event.clientY) ?? press.lastLane;
      const unit = now.unitAt(event.clientX, { snap: !event.altKey });
      const from = press.lane === undefined ? -1 : ids.indexOf(press.lane);
      const to = press.lastLane === undefined ? -1 : ids.indexOf(press.lastLane);
      const tracks =
        from < 0 || to < 0 ? undefined : ids.slice(Math.min(from, to), Math.max(from, to) + 1);
      current.select({
        start: Math.min(press.unit, unit),
        end: Math.max(press.unit, unit),
        ...(tracks ? { tracks } : {}),
      });
    };

    const onUp = (event: PointerEvent) => {
      if (!press || event.pointerId !== press.id) return;
      const done = press;
      press = undefined;
      if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
      if (done.dragging) return;
      // A touch that moved was a scroll.
      if (done.touch && Math.abs(event.clientX - done.x) >= DRAG_THRESHOLD) return;
      latest.current.output.seek(done.unit);
      latest.current.session.select(undefined);
    };

    const onCancel = (event: PointerEvent) => {
      if (press && event.pointerId === press.id) press = undefined;
    };

    track.addEventListener("pointerdown", onDown);
    track.addEventListener("pointermove", onMove);
    track.addEventListener("pointerup", onUp);
    track.addEventListener("pointercancel", onCancel);
    return () => {
      track.removeEventListener("pointerdown", onDown);
      track.removeEventListener("pointermove", onMove);
      track.removeEventListener("pointerup", onUp);
      track.removeEventListener("pointercancel", onCancel);
    };
  }, [timeline]);

  return null;
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
