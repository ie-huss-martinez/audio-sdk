import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { editor, recording, step } from "../../test/editor.js";
import { cleanUp, mount, waitFor } from "../../test/react.js";
import { sessionEvents } from "../../test/session-events.js";
import { AudioEditor } from "./AudioEditor.js";

// Wide enough for the whole editor, so a pointer can reach every part of it.
beforeAll(async () => {
  await page.viewport(1024, 768);
});

afterEach(async () => {
  await cleanUp();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

const said = (text: string) => waitFor(() => expect(document.body.textContent).toContain(text));

const playheadOf = (container: Element) =>
  container.querySelector<HTMLInputElement>('input[aria-label="Playhead"]') as HTMLInputElement;

/** A 2 s recording, with 0.5 s to 1.5 s selected on its track by I and O. */
async function selected() {
  const result = await editor(recording("voice.wav", 2));
  const { container, ref } = result;
  await step(() => ref.current?.seek(4_000));
  await step(() => playheadOf(container).focus());
  await step(() => userEvent.keyboard("i"));
  await step(() => ref.current?.seek(12_000));
  await step(() => userEvent.keyboard("o"));
  await said("Selected 0:00.50 to 0:01.50 on Track 1.");
  return result;
}

describe("editing a range", () => {
  it("fades in over the range, splitting its clip at its edges, as one undo step", async () => {
    const { plan, tool, ref } = await selected();
    await step(() => userEvent.click(tool("audio.fade-in")));
    await waitFor(() => expect(plan().tracks[0]?.clips).toHaveLength(3));
    const [before, inside, after] = plan().tracks[0]?.clips ?? [];
    expect([before?.at, inside?.at, after?.at]).toEqual([0, 4_000, 12_000]);
    expect(inside?.fadeIn).toEqual({ frames: 8_000, curve: "linear" });
    await said("Fade in from 0:00.50 to 0:01.50 on Track 1.");
    await step(() => ref.current?.undo());
    await waitFor(() => expect(plan().tracks[0]?.clips).toHaveLength(1));
  });

  it("sets the range's gain from the inspector, as one undo step", async () => {
    const { container, plan, ref } = await selected();
    const inspector = container.querySelector(".hm-audio-editor-inspector") as Element;
    expect(inspector.querySelector("h2")?.textContent).toBe("Selection");
    const label = [...inspector.querySelectorAll("label")].find(
      (each) => each.textContent === "Gain of the selection, in decibels",
    ) as HTMLLabelElement;
    const field = document.getElementById(label.htmlFor) as HTMLInputElement;
    await step(() => field.focus());
    await step(() => userEvent.keyboard("{Control>}a{/Control}-6{Enter}"));
    await waitFor(() =>
      expect(plan().tracks[0]?.clips.map((clip) => clip.gainDb)).toEqual([0, -6, 0]),
    );
    await said("0:00.50 to 0:01.50 on Track 1 set to -6 dB.");
    await step(() => ref.current?.undo());
    await waitFor(() => expect(plan().tracks[0]?.clips).toHaveLength(1));
  });

  it("fades the selected clip by the default length when there's no range", async () => {
    const { container, plan, tool } = await editor(recording("voice.wav", 2));
    await step(() => container.querySelector<HTMLElement>('[role="option"]')?.focus());
    await step(() => userEvent.click(tool("audio.fade-out")));
    await waitFor(() =>
      expect(plan().tracks[0]?.clips[0]?.fadeOut).toEqual({ frames: 4_000, curve: "linear" }),
    );
    await said("The clip fades out over 0:00.50.");
  });
});

describe("the press layer and the headings", () => {
  it("takes a press on a clip's body, under the lanes", async () => {
    const { container } = await editor(recording("voice.wav", 2));
    const clip = container.querySelector('[role="option"]') as Element;
    const box = clip.getBoundingClientRect();
    // Below the title strip, in the clip's body.
    const target = document.elementFromPoint(box.left + box.width / 2, box.bottom - 2);
    expect(target?.classList.contains("hm-audio-editor-press-layer")).toBe(true);
  });

  it("puts the inspector's heading at the level the host sets", async () => {
    const events = sessionEvents();
    const opened = events.nextLoad();
    const container = await mount(
      <AudioEditor initialFile={recording()} onEvent={events.onEvent} headingLevel={3} />,
      "width: 900px; height: 600px; display: grid; grid-template-rows: minmax(0, 1fr);",
    );
    await opened();
    await waitFor(() =>
      expect(container.querySelector(".hm-audio-editor-inspector h3")?.textContent).toBe(
        "Recording",
      ),
    );
    // Let ui's announcer say the recording opened inside act().
    await step(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  });
});
