import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { disabled, editor, recording, step } from "../../test/editor.js";
import { cleanUp, waitFor } from "../../test/react.js";

afterEach(async () => {
  await cleanUp();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

const options = (container: Element) => [
  ...container.querySelectorAll<HTMLElement>('[role="option"]'),
];
/** The key of the clip focus is on, if it's on one. */
const focused = () => (document.activeElement as HTMLElement | null)?.dataset["hmKey"];
/** Waits for the announcer to say something, inside act(). */
const said = (text: string) => waitFor(() => expect(document.body.textContent).toContain(text));

describe("the clip tools", () => {
  it("are in the toolbar's Clip group, and act on the selected clip", async () => {
    const { container, tool } = await editor(recording());
    const group = container.querySelector('[role="group"][aria-label="Clip"]') as Element;
    expect(
      [...group.querySelectorAll("[data-hm-tool]")].map((each) =>
        each.getAttribute("data-hm-tool"),
      ),
    ).toEqual([
      "audio.split",
      "audio.delete",
      "audio.trim-start",
      "audio.trim-end",
      "audio.fade-in",
      "audio.fade-out",
      "audio.move-earlier",
      "audio.move-later",
      "audio.move-to-track-above",
      "audio.move-to-track-below",
    ]);
    expect(tool("audio.split").getAttribute("aria-keyshortcuts")).toBe("S");
    expect(disabled(tool("audio.delete"))).toBe(true);
    await step(() => options(container)[0]?.focus());
    await waitFor(() => expect(disabled(tool("audio.delete"))).toBe(false));
    // At the start, and on the only track, it can only move later.
    expect(disabled(tool("audio.move-earlier"))).toBe(true);
    expect(disabled(tool("audio.move-later"))).toBe(false);
    expect(disabled(tool("audio.move-to-track-below"))).toBe(true);
    expect((await axe.run(container)).violations.map((each) => each.id)).toEqual([]);
  });

  it("splits at the playhead with S, focusing the part after it", async () => {
    const { container, ref, plan } = await editor(recording("take.wav", 2));
    await step(() => ref.current?.seek(8_000));
    await step(() => options(container)[0]?.focus());
    await step(() => userEvent.keyboard("s"));
    await waitFor(() => expect(plan().tracks[0]?.clips).toHaveLength(2));
    const after = plan().tracks[0]?.clips[1];
    expect(after?.at).toBe(8_000);
    await waitFor(() => expect(focused()).toBe(after?.key));
    await said("Split at 0:01.00.");
  });

  it("says when there's no clip at the playhead to split", async () => {
    const { container, ref, plan } = await editor(recording());
    await step(() => ref.current?.seek(8_000));
    await step(() => options(container)[0]?.focus());
    await step(() => userEvent.keyboard("s"));
    await said("There's no clip on Track 1 at the playhead to split.");
    expect(plan().tracks[0]?.clips).toHaveLength(1);
  });

  it("deletes the selected clip with Delete, leaving its track", async () => {
    const { container, plan } = await editor(recording("voice.wav"), recording("music.wav"));
    await step(() => options(container)[1]?.focus());
    await step(() => userEvent.keyboard("{Delete}"));
    await waitFor(() => expect(plan().tracks[1]?.clips).toHaveLength(0));
    expect(plan().tracks).toHaveLength(2);
    await said("Clip deleted.");
  });

  it("trims to the playhead with [ on the clip and the toolbar's Trim end", async () => {
    const { container, ref, plan, tool } = await editor(recording("take.wav", 2));
    await step(() => ref.current?.seek(4_000));
    await step(() => options(container)[0]?.focus());
    await step(() => userEvent.keyboard("[BracketLeft]"));
    await waitFor(() =>
      expect(plan().tracks[0]?.clips[0]).toMatchObject({ at: 4_000, start: 4_000 }),
    );
    await said("The clip is now 0:00.50 to 0:02.00.");
    await step(() => ref.current?.seek(12_000));
    await step(() => userEvent.click(tool("audio.trim-end")));
    await waitFor(() => expect(plan().tracks[0]?.clips[0]?.end).toBe(12_000));
    await said("The clip is now 0:00.50 to 0:01.50.");
  });

  it("moves the focused clip 10 ms with Alt and the arrows, but not before the start", async () => {
    const { container, plan } = await editor(recording());
    await step(() => options(container)[0]?.focus());
    await step(() => userEvent.keyboard("{Alt>}{ArrowRight}{ArrowRight}{/Alt}"));
    await waitFor(() => expect(plan().tracks[0]?.clips[0]?.at).toBe(160));
    await step(() => userEvent.keyboard("{Alt>}{ArrowLeft}{ArrowLeft}{ArrowLeft}{/Alt}"));
    await said("There's no room for the clip there.");
    expect(plan().tracks[0]?.clips[0]?.at).toBe(0);
  });

  it("moves a clip to another track with Alt+Down, keeping focus on it", async () => {
    const { container, plan, tool, ref } = await editor(recording("voice.wav"));
    await step(() => userEvent.click(tool("audio.add-track")));
    await waitFor(() => expect(plan().tracks).toHaveLength(2));
    const key = plan().tracks[0]?.clips[0]?.key;
    await step(() => options(container)[0]?.focus());
    await step(() => userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}"));
    await waitFor(() => expect(plan().tracks[1]?.clips[0]?.key).toBe(key));
    await waitFor(() => expect(focused()).toBe(key));
    await said("Clip moved to Track 2.");
    // And back, with the toolbar's button.
    await step(() => userEvent.click(tool("audio.move-to-track-above")));
    await waitFor(() => expect(plan().tracks[0]?.clips[0]?.key).toBe(key));
    // A clip can't land on another: the move is refused, and said.
    await step(() => ref.current?.insert(recording("music.wav")));
    await waitFor(() => expect(plan().tracks[2]?.clips).toHaveLength(1));
    await step(() => options(container)[1]?.focus());
    await step(() => userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}"));
    await waitFor(() => expect(plan().tracks[1]?.clips).toHaveLength(1));
    await step(() => userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}"));
    await said("There's no room for the clip there.");
    expect(plan().tracks[0]?.clips).toHaveLength(1);
  });
});
