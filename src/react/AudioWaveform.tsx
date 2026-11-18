import { useTimelineScale } from "@hussmartinez/ui/react";
import { type ReactNode, useEffect, useRef } from "react";
import { dbToGain, gainAt } from "../core/model/envelope.js";
import { peakColumns } from "../core/model/peaks.js";
import { type AudioTrack, clipEnd } from "../core/model/plan.js";
import type { AudioPeaks } from "../core/model/source.js";

/** Subscribes to the timeline's scrolling, zooming and resizing; returns how to stop. */
export type RangeSubscription = (listener: () => void) => () => void;

/**
 * Draws a track's clips from their sources' peaks, never from samples
 * (docs/adr/0005): for each clip in view, its part of its source, at its
 * gain and its track's, with its fades as `gainAt` shapes them, so what's
 * seen is what's heard. Only the range in view is drawn, on a canvas as wide
 * as the viewport, so drawing costs the same at any length and any zoom.
 */
function draw(
  canvas: HTMLCanvasElement,
  track: AudioTrack,
  scale: ReturnType<typeof useTimelineScale>,
  peaksOf: (source: string) => AudioPeaks | undefined,
): void {
  const range = scale.visibleRange();
  const left = scale.toPixels(range.start);
  const cssWidth = Math.max(0, scale.toPixels(range.end) - left);
  // Sized and placed through the CSSOM, which a strict Content Security
  // Policy allows, never with a style attribute.
  canvas.style.insetInlineStart = `${left}px`;
  canvas.style.inlineSize = `${cssWidth}px`;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(cssWidth * ratio);
  const height = Math.round(canvas.clientHeight * ratio);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context || width === 0 || height === 0 || scale.pixelsPerUnit === 0) return;

  const style = getComputedStyle(canvas);
  context.fillStyle = style.color;
  // In a right-to-left layout, time runs leftward.
  const mirrored = style.direction === "rtl";
  const middle = height / 2;
  const trackGain = dbToGain(track.gainDb);

  for (const clip of track.clips) {
    const from = Math.max(clip.at, range.start);
    const to = Math.min(clipEnd(clip), range.end);
    if (to <= from) continue;
    const peaks = peaksOf(clip.source);
    if (!peaks) continue;
    const x0 = (scale.toPixels(from) - left) * ratio;
    const x1 = (scale.toPixels(to) - left) * ratio;
    const columns = Math.max(1, Math.round(x1 - x0));
    const { min, max } = peakColumns(peaks, {
      from: clip.start + (from - clip.at),
      to: clip.start + (to - clip.at),
      columns,
    });
    const framesPerColumn = (to - from) / columns;
    for (let column = 0; column < columns; column += 1) {
      const frame = Math.min(to - 1, Math.floor(from + (column + 0.5) * framesPerColumn));
      const gain = gainAt(clip, frame - clip.at) * trackGain;
      const high = Math.min(1, Math.max(-1, (max[column] as number) * gain));
      const low = Math.min(1, Math.max(-1, (min[column] as number) * gain));
      const x = Math.floor(x0) + column;
      context.fillRect(
        mirrored ? width - x - 1 : x,
        middle - high * middle,
        1,
        Math.max(1, (high - low) * middle),
      );
    }
  }
}

/**
 * A track's waveform, inside its lane's `TimelineLayer`, which is
 * `aria-hidden`: what it shows is in the clips' names and the time as text. It redraws on
 * the next animation frame after the plan, the zoom, the scroll, the size
 * or the colour scheme changes, and never as the playhead moves.
 */
export function AudioWaveform({
  track,
  peaksOf,
  subscribeRange,
}: {
  readonly track: AudioTrack;
  readonly peaksOf: (source: string) => AudioPeaks | undefined;
  readonly subscribeRange: RangeSubscription;
}): ReactNode {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scale = useTimelineScale();

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let request = 0;
    const schedule = () => {
      cancelAnimationFrame(request);
      request = requestAnimationFrame(() => draw(element, track, scale, peaksOf));
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    const queries = ["(prefers-color-scheme: dark)", "(forced-colors: active)"].map((query) =>
      matchMedia(query),
    );
    for (const query of queries) query.addEventListener("change", schedule);
    const unsubscribe = subscribeRange(schedule);
    schedule();
    return () => {
      cancelAnimationFrame(request);
      observer.disconnect();
      unsubscribe();
      for (const query of queries) query.removeEventListener("change", schedule);
    };
  }, [track, scale, peaksOf, subscribeRange]);

  // Hidden from assistive technology by its layer, which holds only it.
  return <canvas ref={canvas} className="hm-audio-editor-waveform" />;
}
