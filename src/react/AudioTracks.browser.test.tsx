import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { disabled, editor, recording, step } from "../../test/editor.js";
import { cleanUp, waitFor } from "../../test/react.js";

afterEach(async () => {
  await cleanUp();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe("the toolbar", () => {
  it("has the tools in groups, with their keys, and each one's state", async () => {
    const { container, tool } = await editor(recording());
    const toolbar = container.querySelector('[role="toolbar"][aria-label="Tools"]') as Element;
    expect(
      [...toolbar.querySelectorAll('[role="group"]')].map((group) =>
        group.getAttribute("aria-label"),
      ),
    ).toEqual(["File", "History", "Tracks", "Clip", "Selection", "Zoom"]);
    expect(tool("audio.undo").getAttribute("aria-keyshortcuts")).toMatch(/Z/);
    expect(tool("audio.zoom-in").getAttribute("title")).toBe("Zoom in (+)");
    // Nothing to undo yet, and one track can't be removed.
    expect(disabled(tool("audio.undo"))).toBe(true);
    expect(disabled(tool("audio.remove-track"))).toBe(true);
    expect(disabled(tool("audio.add-track"))).toBe(false);
    expect((await axe.run(container)).violations.map((each) => each.id)).toEqual([]);
  });

  it("adds a track, focusing its name, and removes one, focusing the one that took its place", async () => {
    const { tool, plan, container } = await editor(recording("voice.wav"), recording("music.wav"));
    const [voice, music] = plan().tracks;
    // Focus in the first lane makes it the current track.
    await step(() => (container.querySelector('[role="option"]') as HTMLElement).focus());
    await step(() => userEvent.click(tool("audio.add-track")));
    await waitFor(() => expect(plan().tracks).toHaveLength(3));
    const added = plan().tracks[1];
    expect(plan().tracks.map((track) => track.key)).toEqual([voice?.key, added?.key, music?.key]);
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Track 2, rename"),
    );
    await waitFor(() => expect(container.ownerDocument.body.textContent).toContain("Track added."));
    // The added track is current now: removing it puts focus on the one below.
    await step(() => userEvent.click(tool("audio.remove-track")));
    await waitFor(() => expect(plan().tracks).toHaveLength(2));
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Track 2, rename"),
    );
    expect(plan().tracks[1]?.key).toBe(music?.key);
  });

  it("moves the current track up and down, keeping focus on it", async () => {
    const { tool, plan, container } = await editor(recording("voice.wav"), recording("music.wav"));
    const [voice, music] = plan().tracks;
    const options = () => [...container.querySelectorAll<HTMLElement>('[role="option"]')];
    await step(() => options()[1]?.focus());
    expect(disabled(tool("audio.move-track-down"))).toBe(true);
    await step(() => userEvent.click(tool("audio.move-track-up")));
    await waitFor(() =>
      expect(plan().tracks.map((track) => track.key)).toEqual([music?.key, voice?.key]),
    );
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Track 1, rename"),
    );
    expect(disabled(tool("audio.move-track-up"))).toBe(true);
  });
});

describe("a track's header", () => {
  it("mutes and solos its track, which its lane's name and the announcer say", async () => {
    const { container, plan } = await editor(recording(), recording("music.wav"));
    const headers = () => [...container.querySelectorAll('[role="toolbar"]')].slice(1);
    const toggle = (header: Element, name: string) =>
      [...header.querySelectorAll("button")].find(
        (button) => button.getAttribute("aria-label") === name || button.textContent === name,
      ) as HTMLButtonElement;
    await step(() => userEvent.click(toggle(headers()[1] as Element, "Mute")));
    await waitFor(() => expect(plan().tracks[1]?.muted).toBe(true));
    expect(toggle(headers()[1] as Element, "Mute").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[aria-label="Track 2, muted"]')).not.toBeNull();
    await waitFor(() => expect(document.body.textContent).toContain("Track 2 muted."));
    await step(() => userEvent.click(toggle(headers()[0] as Element, "Solo")));
    await waitFor(() => expect(plan().tracks[0]?.soloed).toBe(true));
    // The announcer updates on a timer: let it, inside act(), before axe runs.
    await waitFor(() => expect(document.body.textContent).toContain("Track 1 soloed."));
    expect((await axe.run(container)).violations.map((each) => each.id)).toEqual([]);
  });

  it("renames its track in a dialog, and gives focus back to the name", async () => {
    const { container, plan, button } = await editor(recording());
    await step(() => userEvent.click(button("Track 1, rename")));
    const field = await waitFor(() => {
      const found = document.querySelector<HTMLInputElement>("dialog[open] input");
      expect(found).not.toBeNull();
      return found as HTMLInputElement;
    });
    expect(document.activeElement).toBe(field);
    // The field's own arrow keys stay its own: the header's toolbar doesn't take them.
    await step(() => userEvent.keyboard("Voice{ArrowLeft}{ArrowLeft}x"));
    expect(field.value).toBe("Voixce");
    await step(() => userEvent.keyboard("{Backspace}{Enter}"));
    await waitFor(() => expect(plan().tracks[0]?.name).toBe("Voice"));
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Track 1, Voice, rename"),
    );
    expect(container.querySelector('[aria-label="Track 1, Voice"]')).not.toBeNull();
  });

  it("makes each press of a gain key one undo step", async () => {
    const { container, plan, ref } = await editor(recording());
    const gain = container.querySelector<HTMLInputElement>(
      'input[aria-label="Gain"]',
    ) as HTMLInputElement;
    await step(() => gain.focus());
    await step(() => userEvent.keyboard("{ArrowLeft}{ArrowLeft}"));
    await waitFor(() => expect(plan().tracks[0]?.gainDb).toBe(-2));
    expect(gain.getAttribute("aria-valuetext")).toBe("-2 dB");
    await step(() => ref.current?.undo());
    await waitFor(() => expect(plan().tracks[0]?.gainDb).toBe(-1));
  });
});

describe("a track's gain", () => {
  it("makes a click on the slider's track one undo step", async () => {
    const { container, plan, ref } = await editor(recording());
    const gain = container.querySelector<HTMLInputElement>(
      'input[aria-label="Gain"]',
    ) as HTMLInputElement;
    const box = gain.getBoundingClientRect();
    // Near the start of the track: well below 0 dB.
    await step(() => userEvent.click(gain, { position: { x: 4, y: box.height / 2 } }));
    await waitFor(() => expect(plan().tracks[0]?.gainDb).toBeLessThan(-40));
    await step(() => ref.current?.undo());
    await waitFor(() => expect(plan().tracks[0]?.gainDb).toBe(0));
  });

  it("puts a held key's change back with Escape, without an undo step or clearing the selection", async () => {
    const { container, plan, ref, tool } = await editor(recording("voice.wav", 2));
    const selection = () =>
      container.querySelector(".hm-audio-editor-selection")?.textContent ?? undefined;
    // A selection, which Escape would clear if the slider let it through.
    await step(() => ref.current?.seek(4_000));
    await step(() =>
      container.querySelector<HTMLInputElement>('input[aria-label="Playhead"]')?.focus(),
    );
    await step(() => userEvent.keyboard("i"));
    await waitFor(() => expect(selection()).toBeDefined());
    const gain = container.querySelector<HTMLInputElement>(
      'input[aria-label="Gain"]',
    ) as HTMLInputElement;
    await step(() => gain.focus());
    await step(() => userEvent.keyboard("{ArrowLeft>}"));
    await waitFor(() => expect(gain.getAttribute("aria-valuetext")).toBe("-1 dB"));
    await step(() => userEvent.keyboard("{Escape}"));
    await step(() => userEvent.keyboard("{/ArrowLeft}"));
    await waitFor(() => expect(gain.getAttribute("aria-valuetext")).toBe("0 dB"));
    expect(plan().tracks[0]?.gainDb).toBe(0);
    expect(disabled(tool("audio.undo"))).toBe(true);
    expect(selection()).toBeDefined();
  });
});

describe("the editor's keys", () => {
  it("mutes the current track with M, zooms with +, and undoes with the family's keys", async () => {
    const { container, plan, tool } = await editor(
      recording("voice.wav", 2),
      recording("music.wav"),
    );
    const options = [...container.querySelectorAll<HTMLElement>('[role="option"]')];
    await step(() => options[1]?.focus());
    await step(() => userEvent.keyboard("m"));
    await waitFor(() => expect(plan().tracks[1]?.muted).toBe(true));
    await step(() => userEvent.keyboard("+"));
    await waitFor(() => expect(disabled(tool("audio.zoom-out"))).toBe(false));
    await step(() => userEvent.keyboard("{Control>}z{/Control}"));
    await waitFor(() => expect(plan().tracks[1]?.muted).toBe(false));
  });

  it("leaves Home and End to the clips' list, and seeks with them elsewhere", async () => {
    const { container, ref } = await editor(recording("voice.wav", 2));
    await step(() => ref.current?.insert(recording("music.wav"), { at: 16_000 }));
    const time = () => container.querySelector(".hm-audio-editor-time")?.textContent;
    const options = () => [...container.querySelectorAll<HTMLElement>('[role="option"]')];
    await waitFor(() => expect(options()).toHaveLength(2));
    // On the transport's button, End goes to the end of the recording.
    const play = container.querySelector<HTMLButtonElement>('button[aria-label="Play"]');
    await step(() => play?.focus());
    await step(() => userEvent.keyboard("{End}"));
    await waitFor(() => expect(time()).toBe("0:03.00 / 0:03.00"));
    await step(() => userEvent.keyboard("{Home}"));
    await waitFor(() => expect(time()).toBe("0:00.00 / 0:03.00"));
    // In a list of clips, they're the list's: the playhead stays.
    await step(() => options()[0]?.focus());
    await step(() => userEvent.keyboard("{End}"));
    expect(time()).toBe("0:00.00 / 0:03.00");
  });

  it("opens a file from the toolbar's Open", async () => {
    const { container, events, tool, plan } = await editor(recording("first.wav"));
    const picker = container.querySelector<HTMLInputElement>(
      ".hm-audio-editor-picker",
    ) as HTMLInputElement;
    await step(() => userEvent.click(tool("audio.open")));
    const opened = events.nextLoad();
    await step(() => userEvent.upload(picker, recording("second.wav", 2)));
    expect((await opened()).type).toBe("recording_opened");
    await waitFor(() => expect(plan().tracks[0]?.clips[0]?.end).toBe(16_000));
  });
});
