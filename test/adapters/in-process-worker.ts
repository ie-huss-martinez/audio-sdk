import type { WorkerLike } from "@hussmartinez/sdk-core";
import { exposeAudioWorker } from "../../src/adapters/audio-worker/expose.js";

/**
 * The real audio worker's code, run in the test's own thread: a pair of
 * event targets that clone every message, with its transfers, as
 * `postMessage` does. Each call starts a fresh worker, as a new `Worker`
 * would, so termination behaves as in a browser.
 */
export function startInProcessWorker(): WorkerLike {
  const page = new EventTarget();
  const scope = new EventTarget();
  let terminated = false;
  const deliver = (target: EventTarget, message: unknown, transfer: Transferable[]) => {
    const data = structuredClone(message, { transfer });
    setTimeout(() => {
      if (!terminated) target.dispatchEvent(new MessageEvent("message", { data }));
    }, 0);
  };
  exposeAudioWorker({
    scope: {
      postMessage: (message, transfer) => deliver(page, message, transfer),
      addEventListener: (type, listener) => scope.addEventListener(type, listener),
    },
  });
  return {
    postMessage: (message, transfer) => deliver(scope, message, transfer),
    terminate: () => {
      terminated = true;
    },
    addEventListener: (type, listener) => page.addEventListener(type, listener),
    removeEventListener: (type, listener) => page.removeEventListener(type, listener),
  };
}
