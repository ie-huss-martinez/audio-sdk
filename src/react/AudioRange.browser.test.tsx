import axe from "axe-core";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { editor, recording, step } from "../../test/editor.js";
import { cleanUp, waitFor } from "../../test/react.js";

// Wide enough for the whole editor, so a pointer can reach every part of it.
beforeAll(async () => {
  await page.viewport(1024, 768);
});

afterEach(async () => {
  await cleanUp();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

/** Waits for the announcer to say something, inside act(). */
const said = (text: string) => waitFor(() => expect(document.body.textContent).toContain(text));

const selectionText = (container: Element) =>
  container.querySelector(".hm-audio-editor-selection")?.textContent;

const playheadOf = (container: Element) =>
  container.querySelector<HTMLInputElement>('input[aria-label="Playhead"]') as HTMLInputElement;

/**
 * Presses at a frame on a lane, moves to another and lets go, as a mouse
 * does, on whatever is under the pointer: a press on a clip's body reaches
 * the track beneath, which selects.
 */
async function drag(
  container: Element,
  from: { frame: number; lane: number },
  to: { frame: number; lane: number },
  length: number,
) {
  const clips = [...container.querySelectorAll<HTMLElement>('[role="option"]')];
  const box = (clips[0] as HTMLElement).getBoundingClientRect();
  // A lane's clip row: its header may sit beside it or above it.
  const rows = [...container.querySelectorAll<HTMLElement>("[data-hm-lane] .hm-timeline-clips")];
  const point = ({ frame, lane }: { frame: number; lane: number }) => {
    const row = (rows[lane] as HTMLElement).getBoundingClientRect();
    return { clientX: box.left + (frame / length) * box.width, clientY: row.top + row.height / 2 };
  };
  const start = point(from);
  const end = point(to);
  const target = document.elementFromPoint(start.clientX, start.clientY) as Element;
  const init = { bubbles: true, pointerId: 7, pointerType: "mouse", button: 0, buttons: 1 };
  await step(() => {
    target.dispatchEvent(new PointerEvent("pointerdown", { ...init, ...start }));
    target.dispatchEvent(new PointerEvent("pointermove", { ...init, ...end }));
    target.dispatchEvent(new PointerEvent("pointerup", { ...init, ...end, buttons: 0 }));
  });
}

describe("selecting a range", () => {
  it("sets its edges at the playhead with I and O, on every track, and clears it with Escape", async () => {
    const { container, ref } = await editor(recording("voice.wav", 2), recording("music.wav", 2));
    await step(() => ref.current?.seek(4_000));
    await step(() => playheadOf(container).focus());
    await step(() => userEvent.keyboard("i"));
    await said("Selected 0:00.50 to 0:02.00 on every track.");
    expect(selectionText(container)).toBe("Selected 0:00.50 to 0:02.00 on every track");
    await step(() => ref.current?.seek(12_000));
    await step(() => userEvent.keyboard("o"));
    await said("Selected 0:00.50 to 0:01.50 on every track.");
    expect((await axe.run(container)).violations.map((each) => each.id)).toEqual([]);
    await step(() => userEvent.keyboard("{Escape}"));
    await said("Selection cleared.");
    expect(selectionText(container)).toBeUndefined();
  });

  it("extends from the playhead with Shift and its keys", async () => {
    const { container } = await editor(recording("voice.wav", 2));
    await step(() => playheadOf(container).focus());
    await step(() => userEvent.keyboard("{Shift>}{PageUp}{/Shift}"));
    await said("Selected 0:00.00 to 0:01.00 on Track 1.");
    // From the selection's end, Shift moves that end.
    await step(() => userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}"));
    await said("Selected 0:00.00 to 0:00.99 on Track 1.");
  });

  it("selects on the lanes a drag crosses, and a click seeks and clears it", async () => {
    const { container } = await editor(recording("voice.wav", 2), recording("music.wav", 2));
    await drag(container, { frame: 4_000, lane: 0 }, { frame: 12_000, lane: 0 }, 16_000);
    await waitFor(() =>
      expect(selectionText(container)).toMatch(/^Selected 0:00\.\d\d to 0:01\.\d\d on Track 1$/),
    );
    await drag(container, { frame: 4_000, lane: 0 }, { frame: 12_000, lane: 1 }, 16_000);
    await waitFor(() => expect(selectionText(container)).toMatch(/on every track$/));
    await drag(container, { frame: 8_000, lane: 1 }, { frame: 8_000, lane: 1 }, 16_000);
    await waitFor(() => expect(selectionText(container)).toBeUndefined());
    const time = container.querySelector(".hm-audio-editor-time")?.textContent ?? "";
    expect(time).toMatch(/^0:00\.9\d|^0:01\.0\d/);
  });
});

describe("deleting a range", () => {
  it("with Ripple, closes the gap on its tracks only, which their lanes say first", async () => {
    const { container, plan } = await editor(recording("voice.wav", 2), recording("music.wav", 2));
    await drag(container, { frame: 4_000, lane: 0 }, { frame: 12_000, lane: 0 }, 16_000);
    await waitFor(() => expect(selectionText(container)).toMatch(/on Track 1$/));
    // Only Track 1 would move: its lane and header say so.
    expect(
      container.querySelector('[aria-label$="later clips move when the selection is deleted"]'),
    ).not.toBeNull();
    expect(container.querySelector(".hm-audio-editor-track-ripple")?.textContent).toBe("Ripple");
    await step(() => playheadOf(container).focus());
    await step(() => userEvent.keyboard("{Delete}"));
    await waitFor(() => expect(plan().tracks[0]?.clips).toHaveLength(2));
    const [first, second] = plan().tracks[0]?.clips ?? [];
    // The part after the range starts where the range did.
    expect(second?.at).toBe(first?.end);
    expect(plan().tracks[1]?.clips[0]?.end).toBe(16_000);
    await said("Later clips there moved earlier.");
    expect(document.activeElement).toBe(playheadOf(container));
  });

  it("without Ripple, leaves silence where the range was", async () => {
    const { container, ref, plan, tool } = await editor(recording("voice.wav", 2));
    await step(() => userEvent.click(tool("audio.ripple")));
    await said("Ripple off: deleting a range leaves silence.");
    expect(tool("audio.ripple").getAttribute("aria-pressed")).toBe("false");
    await step(() => ref.current?.seek(4_000));
    await step(() => playheadOf(container).focus());
    await step(() => userEvent.keyboard("i"));
    await step(() => ref.current?.seek(12_000));
    await step(() => userEvent.keyboard("o"));
    await step(() => userEvent.keyboard("{Delete}"));
    await waitFor(() => expect(plan().tracks[0]?.clips).toHaveLength(2));
    expect(plan().tracks[0]?.clips.map((clip) => clip.at)).toEqual([0, 12_000]);
    await said("Deleted 0:00.50 to 0:01.50 from Track 1.");
  });
});
