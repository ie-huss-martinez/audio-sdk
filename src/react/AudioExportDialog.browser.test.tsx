import axe from "axe-core";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { editor, recording, step } from "../../test/editor.js";
import { wavFile } from "../../test/fixtures/pcm-files.js";
import { cleanUp, mount, waitFor } from "../../test/react.js";
import { sessionEvents } from "../../test/session-events.js";
import { wavFileSize } from "../adapters/wav/wav-layout.js";
import { EMPTY_METADATA } from "../core/model/plan.js";
import type { AudioRenderResult } from "../core/ports/audio-processor.js";
import { AudioEditor, type AudioEditorHandle } from "./AudioEditor.js";
import { clippedBy } from "./AudioExportDialog.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanUp();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

const said = (text: string) => waitFor(() => expect(document.body.textContent).toContain(text));

const dialog = () => document.querySelector("dialog[open]") as HTMLDialogElement;
const inDialog = (name: string) =>
  [...dialog().querySelectorAll("button")].find((each) => each.textContent === name) as
    | HTMLButtonElement
    | undefined;

/** A loud tone, near full scale: two of them together clip. */
function loud(name: string): File {
  const samples = Array.from({ length: 8_000 }, (_, i) => Math.sin(i / 9) * 0.9);
  return new File([wavFile([samples])], name, { type: "audio/wav" });
}

describe("the export dialog", () => {
  it("opens from the toolbar with a summary of what will be written, and each format's size", async () => {
    const { container, tool } = await editor(recording("voice.wav", 2));
    await step(() => userEvent.click(tool("audio.export")));
    await waitFor(() => expect(dialog()).not.toBeNull());
    const summary = dialog().querySelector(".hm-audio-export-summary") as Element;
    expect([...summary.querySelectorAll("p")].map((each) => each.textContent)).toEqual([
      "0:02.00 long, at 8,000 Hz, Mono.",
      "No metadata is written to the file.",
      "Only the mix and this metadata are written. Nothing leaves your device.",
    ]);
    // 2 s at 8 kHz, mono: 32,000 bytes of 16-bit samples and a 44-byte
    // header; 24-bit and float need the longer, extensible header.
    expect(
      [...dialog().querySelectorAll('[role="radio"]')].map((each) => each.textContent),
    ).toEqual(["16-bit, 32 kB", "24-bit, 48.1 kB", "32-bit float, 64.1 kB"]);
    // ui's dialog fades in: measure contrast once it's fully shown.
    await step(() =>
      Promise.all(
        dialog()
          .getAnimations({ subtree: true })
          .map((each) => each.finished),
      ),
    );
    expect((await axe.run(container)).violations.map((each) => each.id)).toEqual([]);
  });

  it("exports, then focuses Download, which saves the file under its cleaned name", async () => {
    const { container, tool, events } = await editor(recording("voice.wav"));
    const links: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      links.push(this);
    });
    await step(() => userEvent.click(tool("audio.export")));
    await waitFor(() => expect(inDialog("Export")).toBeDefined());
    // The export runs in the worker: wait for it to end, not for a fixed time.
    const done = events.nextExport();
    await step(() => userEvent.click(inDialog("Export") as HTMLButtonElement));
    await done();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Download"));
    await said("The WAV file is ready: 16 kB.");
    await step(() => userEvent.click(inDialog("Download") as HTMLButtonElement));
    expect(links).toHaveLength(1);
    expect(links[0]?.download).toBe("recording.wav");
    expect(links[0]?.href).toMatch(/^blob:/);
    await step(() => userEvent.click(inDialog("Done") as HTMLButtonElement));
    await waitFor(() => expect(dialog()).toBeNull());
    void container;
  });

  it("says which tracks a mute leaves out, and the metadata it writes", async () => {
    const { container, tool, ref } = await editor(recording("voice.wav"), recording("music.wav"));
    const mute = [...container.querySelectorAll<HTMLButtonElement>("button")].filter(
      (each) => each.getAttribute("aria-label") === "Mute",
    )[1] as HTMLButtonElement;
    await step(() => userEvent.click(mute));
    void ref;
    const title = [...container.querySelectorAll("label")].find(
      (each) => each.textContent === "Title",
    ) as HTMLLabelElement;
    await step(() => (document.getElementById(title.htmlFor) as HTMLInputElement).focus());
    await step(() => userEvent.keyboard("Interview{Enter}"));
    await step(() => userEvent.click(tool("audio.export")));
    await waitFor(() => expect(dialog()).not.toBeNull());
    const text = dialog().querySelector(".hm-audio-export-summary")?.textContent ?? "";
    expect(text).toContain("Track 2 is muted, so it won't be in the file.");
    expect(text).toContain("Written to the file: Title.");
  });

  it("reports clipping, and lowers the master gain by that much and exports again", async () => {
    const { tool, plan, events } = await editor(loud("one.wav"), loud("two.wav"));
    await step(() => userEvent.click(tool("audio.export")));
    await waitFor(() => expect(inDialog("Export")).toBeDefined());
    const first = events.nextExport();
    await step(() => userEvent.click(inDialog("Export") as HTMLButtonElement));
    await first();
    const report = await waitFor(() => {
      const found = dialog().querySelector(".hm-audio-export-clipped");
      expect(found).not.toBeNull();
      return found as Element;
    });
    // Two tones at 0.9 sum to 1.8: about 5.1 dB over.
    expect(report.textContent).toMatch(/The mix went 5\.\d dB over full scale/);
    const lower = [...report.querySelectorAll("button")][0] as HTMLButtonElement;
    const second = events.nextExport();
    await step(() => userEvent.click(lower));
    await second();
    await waitFor(() => expect(plan().gainDb).toBeLessThan(-5));
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Download"));
    expect(dialog().querySelector(".hm-audio-export-clipped")).toBeNull();
  });

  it("gives the file to the host's onExport instead, and closes", async () => {
    const exported: [Blob, AudioRenderResult][] = [];
    const events = sessionEvents();
    const opened = events.nextLoad();
    const container = await mount(
      <AudioEditor
        initialFile={recording()}
        onEvent={events.onEvent}
        onExport={(blob, result) => exported.push([blob, result])}
      />,
      "width: 900px; height: 600px; display: grid; grid-template-rows: minmax(0, 1fr);",
    );
    await opened();
    await step(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const exportTool = container.querySelector<HTMLButtonElement>('[data-hm-tool="audio.export"]');
    await step(() => userEvent.click(exportTool as HTMLButtonElement));
    await waitFor(() => expect(inDialog("Export")).toBeDefined());
    const done = events.nextExport();
    await step(() => userEvent.click(inDialog("Export") as HTMLButtonElement));
    await done();
    await waitFor(() => expect(exported).toHaveLength(1));
    expect(exported[0]?.[0].type).toBe("audio/wav");
    expect(exported[0]?.[1].clippedFrames).toBe(0);
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it("exports through the editor's handle without the dialog", async () => {
    const ref = createRef<AudioEditorHandle>();
    const events = sessionEvents();
    const opened = events.nextLoad();
    await mount(<AudioEditor ref={ref} initialFile={recording()} onEvent={events.onEvent} />);
    await opened();
    await step(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    let result: AudioRenderResult | undefined;
    await step(async () => {
      result = await ref.current?.export({ format: { container: "wav", sampleFormat: "pcm24" } });
    });
    expect(result?.blob.size).toBe(
      wavFileSize({
        sampleRate: 8_000,
        channels: 1,
        frames: 8_000,
        sampleFormat: "pcm24",
        metadata: EMPTY_METADATA,
      }),
    );
    expect(dialog()).toBeNull();
  });
});

describe("clippedBy", () => {
  it("rounds up to a tenth of a decibel, so lowering by it never clips", () => {
    expect(clippedBy(5.106)).toBe(5.2);
    expect(clippedBy(3)).toBe(3);
    expect(clippedBy(0.01)).toBe(0.1);
  });
});
