import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { editor, editorSized, recording, step } from "../../test/editor.js";
import { cleanUp, waitFor } from "../../test/react.js";

afterEach(async () => {
  await cleanUp();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

const said = (text: string) => waitFor(() => expect(document.body.textContent).toContain(text));

/** The control a label in the inspector names. */
function control(container: Element, label: string): HTMLInputElement {
  const inspector = container.querySelector(".hm-audio-editor-inspector") as Element;
  const found = [...inspector.querySelectorAll("label")].find((each) => each.textContent === label);
  const input = found?.htmlFor
    ? document.getElementById(found.htmlFor)
    : inspector.querySelector(`[aria-label="${label}"]`);
  expect(input, label).not.toBeNull();
  return input as HTMLInputElement;
}

/** Replaces a field's text and commits it with Enter. */
async function enter(input: HTMLInputElement, text: string) {
  await step(() => input.focus());
  await step(() => userEvent.keyboard("{Control>}a{/Control}"));
  await step(() => userEvent.keyboard(`${text}{Enter}`));
}

describe("the inspector's place", () => {
  it("is beside the timeline where both fit, and below it otherwise", async () => {
    const box = (container: Element, selector: string) =>
      (container.querySelector(selector) as Element).getBoundingClientRect();
    const wide = await editorSized(1_200, recording());
    expect(box(wide.container, ".hm-audio-editor-inspector").left).toBeGreaterThanOrEqual(
      box(wide.container, ".hm-audio-editor-work").right,
    );
    await cleanUp();
    const narrow = await editorSized(900, recording());
    expect(box(narrow.container, ".hm-audio-editor-inspector").top).toBeGreaterThanOrEqual(
      box(narrow.container, ".hm-audio-editor-work").bottom,
    );
  });
});

describe("the inspector, with no clip selected", () => {
  it("shows the recording's facts, and sets its gain, channels and metadata", async () => {
    const { container, plan } = await editor(recording("take.wav", 2));
    const inspector = container.querySelector(".hm-audio-editor-inspector") as Element;
    expect(inspector.querySelector(".hm-audio-editor-inspector-title")?.textContent).toBe(
      "Recording",
    );
    expect(inspector.querySelector(".hm-audio-editor-facts")?.textContent).toBe(
      "Length0:02.00Sample rate8,000 HzTracks1 track",
    );
    await enter(control(container, "Master gain, in decibels"), "-3");
    await waitFor(() => expect(plan().gainDb).toBe(-3));
    const stereo = [...inspector.querySelectorAll('[role="radio"]')].find(
      (each) => each.textContent === "Stereo",
    ) as HTMLElement;
    await step(() => userEvent.click(stereo));
    await waitFor(() => expect(plan().channels).toBe(2));
    await enter(control(container, "Title"), "Interview");
    await waitFor(() => expect(plan().metadata.title).toBe("Interview"));
    // Escape throws typing away.
    const artist = control(container, "Artist");
    await step(() => artist.focus());
    await step(() => userEvent.keyboard("Someone{Escape}"));
    expect(artist.value).toBe("");
    await step(() => artist.blur());
    expect(plan().metadata.artist).toBe("");
    expect((await axe.run(container)).violations.map((each) => each.id)).toEqual([]);
  });
});

describe("the inspector, with a clip selected", () => {
  it("sets the clip's start exactly, as a timecode, and refuses an overlap", async () => {
    const { container, plan, ref } = await editor(recording("voice.wav"));
    const track = plan().tracks[0]?.key as string;
    await step(() => ref.current?.insert(recording("music.wav"), { track, at: 16_000 }));
    await waitFor(() => expect(plan().tracks[0]?.clips).toHaveLength(2));
    await step(() => container.querySelector<HTMLElement>('[role="option"]')?.focus());
    await waitFor(() =>
      expect(container.querySelector(".hm-audio-editor-inspector-title")?.textContent).toBe(
        "Clip on Track 1",
      ),
    );
    const start = control(container, "Start");
    expect(start.value).toBe("0:00.00");
    await enter(start, "0:00.50");
    await waitFor(() => expect(plan().tracks[0]?.clips[0]?.at).toBe(4_000));
    // The second clip starts at 2 s: 1.5 s would run into it.
    await enter(start, "1.5");
    await said("There's no room for the clip there.");
    expect(plan().tracks[0]?.clips[0]?.at).toBe(4_000);
    await waitFor(() => expect(start.value).toBe("0:00.50"));
    // One undo step for the move.
    await step(() => ref.current?.undo());
    await waitFor(() => expect(plan().tracks[0]?.clips[0]?.at).toBe(0));
  });

  it("sets its gain and fades, with their curves", async () => {
    const { container, plan } = await editor(recording("voice.wav"));
    await step(() => container.querySelector<HTMLElement>('[role="option"]')?.focus());
    await enter(control(container, "Gain, in decibels"), "-6");
    await waitFor(() => expect(plan().tracks[0]?.clips[0]?.gainDb).toBe(-6));
    // The slider's keys are a step each.
    const slider = control(container, "Gain");
    await step(() => slider.focus());
    await step(() => userEvent.keyboard("{ArrowRight}"));
    await waitFor(() => expect(plan().tracks[0]?.clips[0]?.gainDb).toBe(-5));
    await enter(control(container, "Fade in, in seconds"), "0.25");
    await waitFor(() => expect(plan().tracks[0]?.clips[0]?.fadeIn.frames).toBe(2_000));
    const curves = container.querySelector('[role="radiogroup"][aria-label="Fade in curve"]');
    const equal = [...(curves?.querySelectorAll('[role="radio"]') ?? [])].find(
      (each) => each.textContent === "Equal power",
    ) as HTMLElement;
    await step(() => userEvent.click(equal));
    await waitFor(() =>
      expect(plan().tracks[0]?.clips[0]?.fadeIn).toEqual({ frames: 2_000, curve: "equalPower" }),
    );
    expect((await axe.run(container)).violations.map((each) => each.id)).toEqual([]);
  });
});
