import { act, createRef } from "react";
import type { AudioPlan } from "../src/core/model/plan.js";
import { AudioEditor, type AudioEditorHandle } from "../src/react/AudioEditor.js";
import { wavFile } from "./fixtures/pcm-files.js";
import { mount } from "./react.js";
import { sessionEvents } from "./session-events.js";

/** A tone at 8 kHz, as a WAV file. */
export function recording(name = "take.wav", seconds = 1): File {
  const samples = Array.from({ length: 8_000 * seconds }, (_, i) => Math.sin(i / 9) * 0.25);
  return new File([wavFile([samples])], name, { type: "audio/wav" });
}

/** Runs something that updates the editor, inside act(). */
export async function step(run: () => unknown): Promise<void> {
  await act(async () => {
    await run();
  });
}

/** Whether a control is disabled as ui's focusable-when-disabled controls are. */
export const disabled = (element: Element): boolean =>
  element.getAttribute("aria-disabled") === "true";

/** An editor with these recordings open, each on a track of its own, and its latest plan. */
export async function editor(...files: File[]) {
  const events = sessionEvents();
  const ref = createRef<AudioEditorHandle>();
  const latest: { plan?: AudioPlan } = {};
  const container = await mount(
    <AudioEditor ref={ref} onEvent={events.onEvent} onChange={(plan) => (latest.plan = plan)} />,
    "width: 900px; height: 600px; display: grid; grid-template-rows: minmax(0, 1fr);",
  );
  const [first, ...rest] = files;
  if (first) await step(() => ref.current?.open(first));
  for (const file of rest) await step(() => ref.current?.insert(file));
  const plan = () => latest.plan as AudioPlan;
  const button = (label: string) =>
    container.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    ) as HTMLButtonElement;
  const tool = (id: string) =>
    container.querySelector<HTMLButtonElement>(`[data-hm-tool="${id}"]`) as HTMLButtonElement;
  return { container, events, ref, plan, button, tool };
}
