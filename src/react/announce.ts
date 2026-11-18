import { useAnnounce } from "@hussmartinez/ui/react";
import { useCallback } from "react";

/** The messages waiting to be said together, by announcer. */
const waiting = new WeakMap<(message: string) => void, string[]>();

/**
 * ui's `announce`, with the messages said in the same moment joined into
 * one, in the order they came. ui's announcer keeps only the latest of
 * several messages in a frame, so a warning and "Recording added.", both
 * said as a recording arrives, would otherwise lose one of them. They're
 * said together once the effects of the commit that raised them have run.
 *
 * It exists only because ui's announcer replaces a message said in the same
 * frame instead of queueing it; it goes away, back to `useAnnounce`, when ui
 * queues or joins them itself (proposed to ui).
 */
export function useJoinedAnnounce(): (message: string) => void {
  const announce = useAnnounce();
  return useCallback(
    (message: string) => {
      const queue = waiting.get(announce);
      if (queue) {
        queue.push(message);
        return;
      }
      waiting.set(announce, [message]);
      queueMicrotask(() => {
        const messages = waiting.get(announce) ?? [];
        waiting.delete(announce);
        announce(messages.join(" "));
      });
    },
    [announce],
  );
}
