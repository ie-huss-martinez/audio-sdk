import axe from "axe-core";
import { act, createRef, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { createFakeEngine } from "../../test/fakes/fake-engine.js";
import { wavFile } from "../../test/fixtures/pcm-files.js";
import { cleanUp, mount, waitFor } from "../../test/react.js";
import { sessionEvents } from "../../test/session-events.js";
import { createAudioEngine } from "../adapters/audio-engine.js";
import { abortError } from "../core/errors/abort.js";
import type { AudioPlan } from "../core/model/plan.js";
import type { AudioEngine } from "../core/ports/audio-engine.js";
import { AudioEditor, type AudioEditorHandle } from "./AudioEditor.js";

afterEach(async () => {
  await cleanUp();
  // The provider releases what it made a moment after unmounting.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

/** One second of a quiet tone at 8 kHz, as a WAV file. */
function recording(name = "take.wav", seconds = 1): File {
  const samples = Array.from({ length: 8_000 * seconds }, (_, i) => Math.sin(i / 9) * 0.25);
  return new File([wavFile([samples])], name, { type: "audio/wav" });
}

async function violations(element: Element): Promise<string[]> {
  const { violations: found } = await axe.run(element);
  return found.map((violation) => `${violation.id}: ${violation.help}`);
}

/** Chooses a file through the drop zone's own file input, as its button does. */
async function choose(container: HTMLElement, file: File): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(".hm-audio-editor input[type=file]");
  if (!input) throw new Error("no file input");
  await step(() => userEvent.upload(input, file));
}

const text = (container: HTMLElement) => container.textContent ?? "";

/**
 * Runs a step that starts the session's work, such as a file chosen or a
 * click, inside act(), as React asks of updates in tests. What it starts
 * later lands in waitFor's act() slices.
 */
async function step(run: () => unknown): Promise<void> {
  await act(async () => {
    await run();
  });
}

describe("AudioEditor", () => {
  it("starts empty, with a drop zone and its button, which axe finds nothing wrong with", async () => {
    const container = await mount(<AudioEditor />);
    const root = container.querySelector(".hm-audio-editor") as HTMLElement;
    expect(root.getAttribute("aria-label")).toBe("Audio editor");
    expect(text(container)).toContain("Drop an audio file here, or choose one.");
    expect(container.querySelector(".hm-audio-editor-stage[data-hm-empty]")).not.toBeNull();
    // The transport is there, with nothing to play.
    const play = container.querySelector('button[aria-label="Play"]') as HTMLButtonElement;
    expect(play.getAttribute("aria-disabled")).toBe("true");
    expect(text(container)).toContain("0:00.00 / 0:00.00");
    expect(await violations(root)).toEqual([]);
  });

  it("opens a chosen file: shows it, puts focus on the playhead, and announces it", async () => {
    const events = sessionEvents();
    const container = await mount(<AudioEditor onEvent={events.onEvent} />);
    const opened = events.nextLoad();
    await choose(container, recording());
    expect((await opened()).type).toBe("recording_opened");
    expect(text(container)).toContain("1 track, 0:01.00 long.");
    expect(text(container)).toContain("0:00.00 / 0:01.00");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Playhead");
    await waitFor(() => expect(text(document.body)).toContain("Recording opened."));
    expect(container.querySelector("[data-hm-empty]")).toBeNull();
    expect(await violations(container.querySelector(".hm-audio-editor") as Element)).toEqual([]);
  });

  it("shows a failed open by its error's text, where the action was", async () => {
    const events = sessionEvents();
    const container = await mount(<AudioEditor onEvent={events.onEvent} />);
    const failed = events.nextLoad();
    await choose(container, new File(["not audio at all"], "notes.wav"));
    expect(await failed()).toMatchObject({ type: "failed", operation: "open" });
    expect(container.querySelector('.hm-audio-editor-error[role="alert"]')?.textContent).toBe(
      "This audio format isn't supported. Try converting the file to WAV, then open it again.",
    );
    // Still empty, so another file can be chosen.
    expect(container.querySelector(".hm-audio-editor input[type=file]")).not.toBeNull();
    expect(await violations(container.querySelector(".hm-audio-editor") as Element)).toEqual([]);
  });

  it("shows an open in progress with Cancel, which stops it and reports nothing", async () => {
    // An engine whose probe waits until it's cancelled.
    const fake = createFakeEngine();
    const engine: AudioEngine = {
      ...fake,
      probe: (_file, options) =>
        new Promise((_resolve, reject) => {
          const signal = options?.signal;
          if (signal?.aborted) {
            reject(abortError(signal));
            return;
          }
          signal?.addEventListener("abort", () => reject(abortError(signal)), { once: true });
        }),
    };
    const container = await mount(<AudioEditor engine={engine} />);
    await choose(container, recording());
    await waitFor(() => expect(container.querySelector("progress")).not.toBeNull());
    // ui's progress bar takes its label as its accessible name.
    expect(container.querySelector("progress")?.getAttribute("aria-label")).toBe(
      "Opening the recording",
    );
    const cancel = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Cancel",
    ) as HTMLButtonElement;
    await step(() => userEvent.click(cancel));
    await waitFor(() => expect(container.querySelector("progress")).toBeNull());
    // No error: ui's announcer keeps an empty alert region of its own.
    expect(container.querySelector(".hm-audio-editor-error")).toBeNull();
    expect(container.querySelector("[data-hm-empty]")).not.toBeNull();
  });

  it("shows warnings in one notice, and keeps a dismissed one away", async () => {
    const events = sessionEvents();
    const container = await mount(
      <AudioEditor
        onEvent={events.onEvent}
        filePolicy={{ maxDuration: { maximum: 3_600_000, warning: 500 } }}
      />,
    );
    const opened = events.nextLoad();
    await choose(container, recording());
    await opened();
    const notices = () => container.querySelector(".hm-audio-editor-notices");
    expect(notices()?.textContent).toMatch(/^This recording is .+ long, and may be slow/);
    expect(notices()?.getAttribute("aria-label")).toBe("Notices");
    expect(await violations(container.querySelector(".hm-audio-editor") as Element)).toEqual([]);
    await step(() =>
      userEvent.click(notices()?.querySelector('button[aria-label="Dismiss"]') as Element),
    );
    await waitFor(() => expect(notices()).toBeNull());
  });

  describe("its notices", () => {
    /** An editor that warns of any recording over half a second, and every message it says. */
    async function warned() {
      const ref = createRef<AudioEditorHandle>();
      const container = await mount(
        <AudioEditor
          ref={ref}
          filePolicy={{ maxDuration: { maximum: 3_600_000, warning: 500 } }}
        />,
      );
      // Every message the polite region says, as a screen reader hears it.
      const said: string[] = [];
      const region = document.querySelector(".hm-announcer [aria-live=polite]") as Element;
      const observer = new MutationObserver(() => {
        if (region.textContent) said.push(region.textContent);
      });
      observer.observe(region, { childList: true, characterData: true, subtree: true });
      const notices = () => [...container.querySelectorAll(".hm-audio-editor-notices li")];
      const warnings = () => said.filter((text) => /long, and may be slow/.test(text));
      const dismiss = () =>
        step(() =>
          userEvent.click(notices()[0]?.querySelector('button[aria-label="Dismiss"]') as Element),
        );
      const frame = () => step(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      return { ref, said, notices, warnings, dismiss, frame, observer };
    }

    it("shows a sentence two recordings raise once, and says it once", async () => {
      const { ref, said, notices, warnings, dismiss, frame, observer } = await warned();
      await step(() => ref.current?.open(recording("voice.wav")));
      await waitFor(() => expect(warnings()).toHaveLength(1));
      // The editor's own message for the open is said too, in the same breath.
      expect(said.at(-1)).toContain("Recording opened.");

      // A second recording of the same length: the same kind, the same sentence.
      await step(() => ref.current?.insert(recording("music.wav")));
      await waitFor(() => expect(said.at(-1)).toBe("Recording added."));
      expect(notices()).toHaveLength(1);
      expect(notices()[0]?.textContent?.match(/long, and may be slow/g)).toHaveLength(1);

      // Dismissing hides the kind; undo and redo never say it again.
      await dismiss();
      expect(notices()).toHaveLength(0);
      await step(() => ref.current?.undo());
      await frame();
      await step(() => ref.current?.redo());
      await frame();
      await frame();
      expect(notices()).toHaveLength(0);
      expect(warnings()).toHaveLength(1);
      observer.disconnect();
    });

    it("keeps a dismissed kind away when undo takes it away and redo brings it back", async () => {
      const { ref, notices, warnings, dismiss, frame, observer } = await warned();
      // A short recording raises nothing; a long one inserted raises the warning.
      await step(() => ref.current?.open(recording("short.wav", 0.25)));
      await frame();
      expect(notices()).toHaveLength(0);
      await step(() => ref.current?.insert(recording("long.wav")));
      await waitFor(() => expect(warnings()).toHaveLength(1));
      await dismiss();
      // Undo removes the warning's recording, so its kind leaves the list.
      await step(() => ref.current?.undo());
      await frame();
      await step(() => ref.current?.redo());
      await frame();
      await frame();
      expect(notices()).toHaveLength(0);
      expect(warnings()).toHaveLength(1);
      observer.disconnect();
    });
  });

  it("tells the host each new plan, and answers its ref", async () => {
    const plans: AudioPlan[] = [];
    const ref = createRef<AudioEditorHandle>();
    const container = await mount(<AudioEditor ref={ref} onChange={(plan) => plans.push(plan)} />);
    await step(() => ref.current?.open(recording()));
    await waitFor(() => expect(plans).toHaveLength(1));
    await step(() => ref.current?.insert(recording("music.wav", 2)));
    await waitFor(() => expect(plans.at(-1)?.tracks).toHaveLength(2));
    expect(text(container)).toContain("2 tracks, 0:02.00 long.");
    await waitFor(() => expect(text(document.body)).toContain("Recording added."));
    await step(() => ref.current?.undo());
    await waitFor(() => expect(plans.at(-1)?.tracks).toHaveLength(1));
    await step(() => ref.current?.seek(4_000));
    await waitFor(() => expect(text(container)).toContain("0:00.50 / 0:01.00"));
  });

  it("opens an initial file, through StrictMode's second mount, and never destroys what it's given", async () => {
    const engine = createAudioEngine();
    const destroy = vi.spyOn(engine, "destroy");
    const events = sessionEvents();
    const opened = events.nextLoad();
    const container = await mount(
      <StrictMode>
        <AudioEditor engine={engine} initialFile={recording()} onEvent={events.onEvent} />
      </StrictMode>,
    );
    expect((await opened()).type).toBe("recording_opened");
    expect(text(container)).toContain("1 track, 0:01.00 long.");
    // One recording, opened once.
    expect(container.querySelectorAll(".hm-audio-editor")).toHaveLength(1);
    await cleanUp();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(destroy).not.toHaveBeenCalled();
    await engine.destroy();
  });

  it("takes ui's type and colour from hm-text, and leaves its own look out when unstyled", async () => {
    const container = await mount(
      <>
        <AudioEditor className="styled" />
        <AudioEditor className="plain" unstyled />
      </>,
    );
    const styled = container.querySelector(".styled") as HTMLElement;
    const plain = container.querySelector(".plain") as HTMLElement;
    expect(styled.classList.contains("hm-text")).toBe(true);
    expect(getComputedStyle(styled).display).toBe("flex");
    expect(getComputedStyle(styled).fontFamily).not.toMatch(/^"?Times/);
    expect(plain.classList.contains("hm-text")).toBe(false);
    expect(getComputedStyle(plain).display).toBe("block");
  });
});
