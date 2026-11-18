// pdf-sdk's test/react.tsx, unchanged, so React tests mount, style and wait
// the same way across the family.
import uiStylesUrl from "@hussmartinez/ui/styles.css?url";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import stylesUrl from "../src/styles.css?url";

// Tells React these tests wrap updates in act(), as a test environment does.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => void | Promise<void>> = [];

/** How long each of {@link waitFor}'s act() slices waits, in milliseconds. */
const SLICE = 20;

/** How long {@link waitFor} tries by default, as `vi.waitFor` does, in milliseconds. */
const TIMEOUT = 1_000;

/**
 * Retries `callback` until it stops throwing, waiting between attempts only
 * inside `act()`. Engines, workers, observers, animation frames and timers
 * update the components while a test waits, and those updates must land in
 * an act scope, or React warns. Each slice is short, because React applies
 * what was queued in a scope only when it ends, and the next step, such as
 * an effect that starts a drawing, needs it.
 *
 * It's a loop rather than `vi.waitFor`, which schedules each retry with a
 * timer: that left a moment outside `act()` between slices, where such an
 * update could land. Here, only microtasks run between a slice and the next
 * attempt.
 */
export async function waitFor<T>(
  callback: () => T | Promise<T>,
  { timeout = TIMEOUT }: { readonly timeout?: number } = {},
): Promise<T> {
  const deadline = performance.now() + timeout;
  for (;;) {
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, SLICE)));
    try {
      return await callback();
    } catch (error) {
      if (performance.now() >= deadline) throw error;
    }
  }
}

/** Undoes everything mount() and loadStyles() did. Call it in afterEach. */
export async function cleanUp(): Promise<void> {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
}

/** What {@link loadStyles} loads. */
export interface StyleOptions {
  /**
   * Load `@hussmartinez/ui/styles.css` first, as hosts must (sdk-core ADR
   * 0036). Defaults to true; false checks what still holds without it.
   */
  readonly ui?: boolean;
}

async function loadStylesheet(href: string): Promise<void> {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  await new Promise((resolve) => {
    link.addEventListener("load", resolve, { once: true });
    document.head.append(link);
  });
  cleanups.push(() => link.remove());
}

/** Loads ui's styles.css, unless `ui` is false, then the package's. */
export async function loadStyles({ ui = true }: StyleOptions = {}): Promise<void> {
  if (ui) await loadStylesheet(uiStylesUrl);
  await loadStylesheet(stylesUrl);
}

/** Mounts a tree in a box of the given CSS, with the styles a host loads. */
export async function mount(
  tree: ReactNode,
  css = "width: 800px; height: 600px; display: grid; grid-template-rows: minmax(0, 1fr);",
  styles: StyleOptions = {},
) {
  await loadStyles(styles);
  const container = document.createElement("div");
  container.style.cssText = css;
  document.body.append(container);
  let root: Root | undefined;
  await act(async () => {
    root = createRoot(container);
    root.render(tree);
  });
  cleanups.push(() => {
    act(() => root?.unmount());
    container.remove();
  });
  return container;
}
