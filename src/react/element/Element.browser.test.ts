import uiStylesUrl from "@hussmartinez/ui/styles.css?url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { wavFile } from "../../../test/fixtures/pcm-files.js";
import type { AudioPlan } from "../../core/model/plan.js";
import { defineAudioEditorElement } from "../../element.js";
import stylesUrl from "../../styles.css?url";
import type { AudioEditorElementMethods, AudioEditorElementProps } from "./mount.js";

// The element renders on its own React root, as a host's page would: these
// tests watch it from outside, as image-sdk's element tests do, not
// through React's act().

type Editor = HTMLElement & Partial<AudioEditorElementProps> & AudioEditorElementMethods;

const links: HTMLLinkElement[] = [];
beforeAll(async () => {
  for (const href of [uiStylesUrl, stylesUrl]) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    await new Promise((resolve) => {
      link.addEventListener("load", resolve, { once: true });
      document.head.append(link);
    });
    links.push(link);
  }
});
afterAll(() => {
  for (const link of links) link.remove();
});

const editors: HTMLElement[] = [];
afterEach(async () => {
  for (const editor of editors.splice(0)) editor.remove();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

async function until(condition: () => boolean, what: string, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (condition()) return;
  throw new Error(`timed out waiting for ${what}`);
}

/** A tone with a name, which no event may carry. */
function recording(seconds = 1): File {
  const samples = Array.from({ length: 8_000 * seconds }, (_, i) => Math.sin(i / 9) * 0.25);
  return new File([wavFile([samples])], "private-interview.wav", { type: "audio/wav" });
}

function create(attributes: Record<string, string> = {}): Editor {
  defineAudioEditorElement();
  const editor = document.createElement("hm-audio-editor") as Editor;
  for (const [name, value] of Object.entries(attributes)) editor.setAttribute(name, value);
  editor.style.width = "900px";
  editor.style.height = "600px";
  editors.push(editor);
  return editor;
}

/** Every event's detail, by name, as JSON: what a host could send anywhere. */
function record(editor: HTMLElement) {
  const events: { name: string; detail: unknown; json: string }[] = [];
  for (const name of ["change", "event", "export", "error"]) {
    editor.addEventListener(`hm-audio-editor-${name}`, (event) => {
      const { detail } = event as CustomEvent;
      events.push({ name, detail, json: JSON.stringify(detail) });
    });
  }
  return events;
}

const tool = (editor: HTMLElement, id: string) =>
  editor.querySelector<HTMLButtonElement>(`[data-hm-tool="${id}"]`);
const lastPlan = (events: ReturnType<typeof record>) =>
  events.filter((event) => event.name === "change").at(-1)?.detail as AudioPlan | undefined;

describe("<hm-audio-editor> (docs/adr/0005, sdk-core ADR 0040)", () => {
  it("registers once, and renders the editor into its light DOM", async () => {
    // Importing the entry registered nothing: defining it does.
    expect(customElements.get("hm-audio-editor")).toBeUndefined();
    const Class = defineAudioEditorElement();
    expect(defineAudioEditorElement()).toBe(Class);
    expect(customElements.get("hm-audio-editor")).toBe(Class);
    const editor = create();
    document.body.append(editor);
    await until(() => editor.querySelector("section") !== null, "the editor");
    expect(editor.shadowRoot).toBeNull();
    // The package's stylesheet makes it a block, which the host sizes.
    expect(getComputedStyle(editor).display).toBe("block");
    expect(editor.querySelector("section")?.getAttribute("aria-label")).toBe("Audio editor");
  });

  it("opens its file property, fires change with the plan, and forwards the handle's methods", async () => {
    const editor = create();
    const events = record(editor);
    document.body.append(editor);
    editor.file = recording();
    await until(() => (lastPlan(events)?.tracks.length ?? 0) === 1, "the open");

    // insert() adds a track; undo() and redo() take it away and back.
    await editor.insert(recording());
    await until(() => lastPlan(events)?.tracks.length === 2, "the insert");
    editor.undo();
    await until(() => lastPlan(events)?.tracks.length === 1, "the undo");
    editor.redo();
    await until(() => lastPlan(events)?.tracks.length === 2, "the redo");

    editor.seek(4_000);
    await until(
      () => editor.querySelector(".hm-audio-editor-time")?.textContent === "0:00.50 / 0:01.00",
      "the seek",
    );

    const exported = await editor.export({ format: { container: "wav", sampleFormat: "pcm16" } });
    expect(exported.blob.type).toBe("audio/wav");
    expect(exported.clippedFrames).toBe(0);

    // A host's usage events: anonymous, and never the file's name.
    expect(events.some((event) => event.name === "event")).toBe(true);
    for (const event of events) expect(event.json).not.toContain("private-interview");
  });

  it("opens through open() as soon as it's connected, before its first render", async () => {
    const editor = create();
    const events = record(editor);
    document.body.append(editor);
    await editor.open(recording(2));
    await until(() => lastPlan(events)?.tracks[0]?.clips[0]?.end === 16_000, "the open");
  });

  it("rejects calls waiting for its first render with ABORTED when it's removed first", async () => {
    const editor = create();
    document.body.append(editor);
    // Before the first render, which never comes: removal unmounts the editor first.
    const waiting = [
      editor.open(recording()),
      editor.insert(recording()),
      editor.export(),
      editor.play(),
    ];
    editor.remove();
    const settled = await Promise.race([
      Promise.allSettled(waiting),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 2_000)),
    ]);
    expect(settled, "the waiting calls settle").not.toBe("hung");
    for (const result of settled as PromiseSettledResult<unknown>[]) {
      expect(result.status).toBe("rejected");
      expect((result as PromiseRejectedResult).reason).toMatchObject({
        name: "AudioError",
        code: "ABORTED",
        details: { reason: "removed" },
      });
    }
  });

  it("takes theme, locale and tools from attributes, and follows their changes", async () => {
    const editor = create({ theme: "dark", tools: "audio.undo audio.redo" });
    document.body.append(editor);
    await until(() => tool(editor, "audio.undo") !== null, "the tools");
    expect(editor.getAttribute("data-hm-theme")).toBe("dark");
    expect(tool(editor, "audio.open")).toBeNull();

    editor.setAttribute("theme", "light");
    editor.setAttribute("tools", "audio.open");
    await until(() => tool(editor, "audio.open") !== null, "the new tools");
    expect(editor.getAttribute("data-hm-theme")).toBe("light");
    expect(tool(editor, "audio.undo")).toBeNull();
    editor.removeAttribute("theme");
    await until(() => !editor.hasAttribute("data-hm-theme"), "the inherited theme");
  });

  it("fires error with the code and no name, for a file it can't open", async () => {
    const editor = create();
    const events = record(editor);
    document.body.append(editor);
    editor.file = new File([new Uint8Array([1, 2, 3, 4])], "private-interview.wav", {
      type: "audio/wav",
    });
    await until(() => events.some((event) => event.name === "error"), "the error");
    const error = events.find((event) => event.name === "error")?.detail as { code: string };
    expect(error.code).toMatch(/^[A-Z_]+$/);
    for (const event of events) expect(event.json).not.toContain("private-interview");
  });

  it("fires export after the dialog's export, with a report and no file", async () => {
    const editor = create();
    const events = record(editor);
    document.body.append(editor);
    editor.file = recording();
    await until(() => (lastPlan(events)?.tracks.length ?? 0) === 1, "the open");
    await until(
      () => tool(editor, "audio.export")?.getAttribute("aria-disabled") !== "true",
      "Export",
    );
    tool(editor, "audio.export")?.click();
    await until(() => editor.querySelector("dialog[open]") !== null, "the dialog");
    const confirm = [...editor.querySelectorAll<HTMLButtonElement>("dialog button")].find(
      (element) => element.textContent === "Export",
    );
    confirm?.click();
    await until(() => events.some((event) => event.name === "export"), "the export event");
    const report = events.find((event) => event.name === "export")?.detail as object;
    expect(report).toMatchObject({ sampleFormat: "pcm16", size: 16_044, clippedFrames: 0 });
    expect(Object.values(report).some((value) => value instanceof Blob)).toBe(false);
  });

  it("keeps the editor across a move, and tears it down when removed", async () => {
    const editor = create();
    const events = record(editor);
    document.body.append(editor);
    editor.file = recording();
    await until(() => (lastPlan(events)?.tracks.length ?? 0) === 1, "the open");
    const section = editor.querySelector("section");
    // A move within the document keeps the same editor and its recording.
    const holder = document.createElement("div");
    document.body.append(holder);
    holder.append(editor);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(editor.querySelector("section")).toBe(section);
    expect(editor.querySelector('[role="option"]')).not.toBeNull();
    // Removal tears it down.
    editor.remove();
    holder.remove();
    await until(() => editor.querySelector("section") === null, "the teardown");
  });
});
