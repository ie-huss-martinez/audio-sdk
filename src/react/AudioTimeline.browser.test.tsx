import axe from "axe-core";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { wavFile } from "../../test/fixtures/pcm-files.js";
import { cleanUp, mount, waitFor } from "../../test/react.js";
import { sessionEvents } from "../../test/session-events.js";
import type { AudioSession } from "../core/session/session.js";
import { AudioEditor } from "./AudioEditor.js";
import { AudioStage } from "./AudioStage.js";
import { AudioEditorProvider, useAudioSession } from "./context.js";

afterEach(async () => {
  await cleanUp();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

/** A tone at 8 kHz, as a WAV file. */
function recording(name = "take.wav", seconds = 1): File {
  const samples = Array.from({ length: 8_000 * seconds }, (_, i) => Math.sin(i / 9) * 0.5);
  return new File([wavFile([samples])], name, { type: "audio/wav" });
}

async function step(run: () => unknown): Promise<void> {
  await act(async () => {
    await run();
  });
}

/** Gives the test the provider's session. */
function Grab({ into }: { readonly into: { session?: AudioSession } }): ReactNode {
  into.session = useAudioSession().session;
  return null;
}

/** An editor from its building blocks, with its session in `found`. */
async function editor(found: { session?: AudioSession }, ...files: File[]) {
  const container = await mount(
    <AudioEditorProvider>
      <Grab into={found} />
      <AudioStage />
    </AudioEditorProvider>,
  );
  const session = found.session as AudioSession;
  const [first, ...rest] = files;
  if (first) await step(() => session.open(first));
  for (const file of rest) await step(() => session.insert(file));
  await waitFor(() => expect(container.querySelector('[role="listbox"]')).not.toBeNull());
  return { container, session };
}

const named = (container: HTMLElement, selector: string) =>
  [...container.querySelectorAll(selector)].map((element) => element.getAttribute("aria-label"));

describe("the timeline", () => {
  it("gives each track a lane, and each clip a name that says where it is", async () => {
    const found: { session?: AudioSession } = {};
    const { container } = await editor(found, recording("voice.wav"), recording("music.wav", 2));
    expect(named(container, '[role="listbox"]')).toEqual(["Clips on Track 1", "Clips on Track 2"]);
    expect(named(container, '[role="option"]')).toEqual([
      "voice.wav, clip 1 of 1 on Track 1, 0:00.00 to 0:01.00",
      "music.wav, clip 1 of 1 on Track 2, 0:00.00 to 0:02.00",
    ]);
    // A clip shows its recording's name, which starts its accessible name.
    expect(container.querySelector('[role="option"]')?.textContent).toContain("voice.wav");
    expect((await axe.run(container)).violations.map((each) => each.id)).toEqual([]);
  });

  it("names a track that's muted, or left out by a solo, and the gain of a clip", async () => {
    const found: { session?: AudioSession } = {};
    const { container, session } = await editor(found, recording(), recording("music.wav"));
    const [voice, music] = session.getSnapshot().plan?.tracks ?? [];
    await step(() => {
      session.execute([
        { type: "audio.setTrack", key: music?.key as string, name: "Music", muted: true },
        { type: "audio.setGain", keys: [voice?.clips[0]?.key as string], gainDb: -3 },
      ]);
    });
    await waitFor(() =>
      expect(container.querySelector("[data-hm-silent]")?.textContent).toContain("Track 2, Music"),
    );
    const labels = () =>
      [...container.querySelectorAll(".hm-audio-editor-timeline [aria-label]")].map((each) =>
        each.getAttribute("aria-label"),
      );
    expect(labels()).toContain("Track 2, Music, muted");
    expect(named(container, '[role="option"]')[0]).toBe(
      "take.wav, clip 1 of 1 on Track 1, 0:00.00 to 0:01.00, -3 dB",
    );
    await step(() => {
      session.execute([
        { type: "audio.setTrack", key: music?.key as string, muted: false },
        { type: "audio.setTrack", key: voice?.key as string, soloed: true },
      ]);
    });
    await waitFor(() => expect(labels()).toContain("Track 2, Music, silenced by solo"));
  });

  it("moves the playhead by 10 ms with the arrow keys and by a second with Page Down", async () => {
    const events = sessionEvents();
    const opened = events.nextLoad();
    const container = await mount(
      <AudioEditor initialFile={recording("take.wav", 3)} onEvent={events.onEvent} />,
    );
    await opened();
    const slider = container.querySelector('input[aria-label="Playhead"]') as HTMLInputElement;
    expect(document.activeElement).toBe(slider);
    expect(slider.getAttribute("aria-valuetext")).toBe("0:00.00");
    await step(() => userEvent.keyboard("{ArrowRight}{ArrowRight}"));
    await waitFor(() => expect(slider.getAttribute("aria-valuetext")).toBe("0:00.02"));
    await step(() => userEvent.keyboard("{PageUp}"));
    await waitFor(() => expect(slider.getAttribute("aria-valuetext")).toBe("0:01.02"));
    expect(container.textContent).toContain("0:01.02 / 0:03.00");
  });

  it("zooms in and out with its buttons, from fitting the whole recording", async () => {
    const events = sessionEvents();
    const opened = events.nextLoad();
    const container = await mount(
      <AudioEditor initialFile={recording("take.wav", 2)} onEvent={events.onEvent} />,
    );
    await opened();
    const button = (label: string) =>
      container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
    expect(button("Zoom out").getAttribute("aria-disabled")).toBe("true");
    expect(button("Fit to width").getAttribute("aria-disabled")).toBe("true");
    const track = () =>
      (container.querySelector(".hm-timeline-track") as HTMLElement).getBoundingClientRect().width;
    const fitted = track();
    await step(() => userEvent.click(button("Zoom in")));
    await waitFor(() => expect(track()).toBeGreaterThan(fitted * 1.5));
    expect(button("Zoom out").getAttribute("aria-disabled")).not.toBe("true");
    await step(() => userEvent.click(button("Fit to width")));
    await waitFor(() => expect(track()).toBeCloseTo(fitted, 0));
  });

  it("shows each lane's waveform through its clips, which are see-through", async () => {
    const events = sessionEvents();
    const opened = events.nextLoad();
    const container = await mount(
      <AudioEditor initialFile={recording("take.wav", 2)} onEvent={events.onEvent} />,
    );
    await opened();
    const clip = await waitFor(() => {
      const found = container.querySelector<HTMLElement>('[role="option"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    // ui's clips are filled; the editor's are clear, so the layer under them shows.
    expect(getComputedStyle(clip).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    const layer = container.querySelector(".hm-audio-editor-wave-layer") as Element;
    const clips = clip.closest('[role="listbox"]') as Element;
    expect(layer.compareDocumentPosition(clips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Let ui's announcer say the recording opened inside act().
    await step(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  });

  it("draws each lane's waveform from the peaks, never reading samples", async () => {
    const events = sessionEvents();
    const opened = events.nextLoad();
    const container = await mount(
      <AudioEditor initialFile={recording("take.wav", 2)} onEvent={events.onEvent} />,
    );
    await opened();
    const canvas = await waitFor(() => {
      const found = container.querySelector<HTMLCanvasElement>("canvas.hm-audio-editor-waveform");
      expect(found?.width).toBeGreaterThan(0);
      return found as HTMLCanvasElement;
    });
    const drawn = () => {
      const pixels = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels ? pixels.some((value, index) => index % 4 === 3 && value > 0) : false;
    };
    await waitFor(() => expect(drawn()).toBe(true));
    expect(canvas.closest('[aria-hidden="true"]')).not.toBeNull();
    // A zoom redraws it, from the peaks: no channel's samples are read.
    const read = vi.spyOn(AudioBuffer.prototype, "getChannelData");
    const zoomIn = container.querySelector('button[aria-label="Zoom in"]') as HTMLButtonElement;
    await step(() => userEvent.click(zoomIn));
    await step(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    await waitFor(() => expect(drawn()).toBe(true));
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
  });
});
