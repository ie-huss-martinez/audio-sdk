import { act } from "react";
import type { AudioSessionEvent } from "../src/core/session/session.js";

/**
 * The session's events, for tests that wait for an open or an insert to end
 * rather than for a fixed time. An open starts the worker, which under load,
 * and in Firefox, takes far longer than any fixed wait should assume; its
 * event comes when it's done, however long that takes, and the test's own
 * timeout still bounds it.
 */
export function sessionEvents() {
  const seen: AudioSessionEvent[] = [];
  const waiting: {
    from: number;
    test: (event: AudioSessionEvent) => boolean;
    resolve: (event: AudioSessionEvent) => void;
  }[] = [];
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
      const from = seen.length;
      const ended = (event: AudioSessionEvent) =>
        event.type === "recording_opened" ||
        event.type === "recording_inserted" ||
        (event.type === "failed" && (event.operation === "open" || event.operation === "insert"));
      const promise = new Promise<AudioSessionEvent>((resolve) => {
        const early = seen.slice(from).find(ended);
        if (early) resolve(early);
        else waiting.push({ from, test: ended, resolve });
      });
      return () => act(async () => promise);
    },
  };
}
