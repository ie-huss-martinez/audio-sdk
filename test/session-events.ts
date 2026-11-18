import { act } from "react";
import type { AudioSessionEvent } from "../src/core/session/session.js";

/**
 * The session's events, for tests that wait for an open, an insert or an
 * export to end rather than for a fixed time. Each runs in the worker, which
 * under load, and in Firefox, takes far longer than any fixed wait should
 * assume; its event comes when it's done, however long that takes, and the
 * test's own timeout still bounds it.
 */
export function sessionEvents() {
  const seen: AudioSessionEvent[] = [];
  const waiting: {
    from: number;
    test: (event: AudioSessionEvent) => boolean;
    resolve: (event: AudioSessionEvent) => void;
  }[] = [];
  /** A wait for the first event from now that ends what's awaited. */
  const next = (ended: (event: AudioSessionEvent) => boolean) => {
    const from = seen.length;
    const promise = new Promise<AudioSessionEvent>((resolve) => {
      const early = seen.slice(from).find(ended);
      if (early) resolve(early);
      else waiting.push({ from, test: ended, resolve });
    });
    return () => act(async () => promise);
  };
  return {
    /** Pass as the editor's `onEvent`. */
    onEvent(event: AudioSessionEvent): void {
      seen.push(event);
      for (const waiter of [...waiting]) {
        if (waiter.test(event)) {
          waiting.splice(waiting.indexOf(waiter), 1);
          waiter.resolve(event);
        }
      }
    },
    /**
     * The next load to end from now: an open, an insert, or either failing.
     * Call it before the step that starts the load, and await it after,
     * inside act(), so every update the load makes lands in one act scope.
     */
    nextLoad(): () => Promise<AudioSessionEvent> {
      return next(
        (event) =>
          event.type === "recording_opened" ||
          event.type === "recording_inserted" ||
          (event.type === "failed" && (event.operation === "open" || event.operation === "insert")),
      );
    },
    /**
     * The next export to end from now, or fail: the worker's render and
     * encode, which under load, and in Firefox, outlast any fixed wait. Use
     * it as {@link nextLoad} is used.
     */
    nextExport(): () => Promise<AudioSessionEvent> {
      return next(
        (event) =>
          event.type === "recording_exported" ||
          (event.type === "failed" && event.operation === "export"),
      );
    },
  };
}
