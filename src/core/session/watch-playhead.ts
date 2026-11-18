import type { AudioOutput } from "../ports/audio-output.js";

/**
 * How {@link watchPlayhead} waits for the next frame to draw: the page's
 * `requestAnimationFrame` by default.
 *
 * @public
 */
export interface AudioFrameScheduler {
  request(callback: () => void): unknown;
  cancel(handle: unknown): void;
}

/** The page's animation frames, or a timer at about the same rate where there are none. */
function pageFrames(): AudioFrameScheduler {
  const page = globalThis as {
    requestAnimationFrame?: (callback: () => void) => number;
    cancelAnimationFrame?: (handle: number) => void;
  };
  if (page.requestAnimationFrame && page.cancelAnimationFrame) {
    const { requestAnimationFrame: request, cancelAnimationFrame: cancel } = page;
    return {
      request: (callback) => request(callback),
      cancel: (handle) => cancel(handle as number),
    };
  }
  return {
    request: (callback) => setTimeout(callback, 16),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

/**
 * Follows an output's playhead (point 8 of #54), without a framework: calls
 * `listener` with the playhead, in whole frames, now, whenever it jumps, as
 * after a seek or a stop, and on every animation frame while playing. It
 * calls only when the frame differs from the last one it gave, and asks for
 * no frames while nothing plays. Returns a function that stops it.
 *
 * It reads the page's `requestAnimationFrame` when it's called, never on
 * import, so the entry stays server-safe.
 *
 * @example
 * ```ts
 * const stop = watchPlayhead(output, (frame) => {
 *   playhead.textContent = formatTimecode(frame, plan.sampleRate);
 * });
 * ```
 *
 * @public
 */
export function watchPlayhead(
  output: AudioOutput,
  listener: (frame: number) => void,
  frames: AudioFrameScheduler = pageFrames(),
): () => void {
  let last: number | undefined;
  let pending: unknown;
  let stopped = false;

  const report = () => {
    const frame = output.position();
    if (frame === last) return;
    last = frame;
    listener(frame);
  };
  const tick = () => {
    pending = undefined;
    if (stopped) return;
    report();
    if (output.getSnapshot().state === "playing") pending = frames.request(tick);
  };
  const changed = () => {
    if (stopped) return;
    report();
    if (output.getSnapshot().state === "playing") {
      pending ??= frames.request(tick);
    } else if (pending !== undefined) {
      frames.cancel(pending);
      pending = undefined;
    }
  };

  const unsubscribe = output.subscribe(changed);
  changed();
  return () => {
    stopped = true;
    unsubscribe();
    if (pending !== undefined) frames.cancel(pending);
    pending = undefined;
  };
}
