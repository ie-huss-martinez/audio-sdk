import { describe, expect, it, vi } from "vitest";
import { encodeFakeAudio } from "../../../test/fakes/fake-audio.js";
import { createFakeEngine } from "../../../test/fakes/fake-engine.js";
import { createFakeOutput } from "../../../test/fakes/fake-output.js";
import { planLength } from "../model/plan.js";
import { connectOutput } from "./connect-output.js";
import { createAudioSession } from "./session.js";

const RATE = 8_000;
const recording = (frames: number) =>
  encodeFakeAudio({
    sampleRate: RATE,
    samples: [Array.from({ length: frames }, (_, i) => (i % 7) / 10)],
  });

function setup() {
  const session = createAudioSession({ engine: createFakeEngine() });
  const { output, clock } = createFakeOutput();
  const load = vi.spyOn(output, "load");
  const stop = vi.spyOn(output, "stop");
  return { session, output, clock, load, stop };
}

describe("connectOutput", () => {
  it("loads the plan with its decoded sources when a recording opens", async () => {
    const { session, output, load } = setup();
    connectOutput(session, output);
    expect(load).not.toHaveBeenCalled();
    await session.open(recording(1_000));
    const [plan, sources] = load.mock.lastCall ?? [];
    expect(plan).toBe(session.getSnapshot().plan);
    const id = session.getSnapshot().sources[0]?.id as string;
    expect(sources?.get(id)).toBe(session.getAudio(id));
  });

  it("keeps playing from the playhead through edits and undo, with each new plan", async () => {
    const { session, output, clock, load, stop } = setup();
    connectOutput(session, output);
    await session.open(recording(1_000));
    await output.play();
    clock.advance(300);
    session.execute({
      type: "audio.deleteRange",
      start: 600,
      end: 900,
      newKey: session.createKey(),
    });
    expect(load.mock.lastCall?.[0]).toBe(session.getSnapshot().plan);
    expect(output.getSnapshot().state).toBe("playing");
    expect(output.position()).toBe(300);
    session.undo();
    expect(planLength(load.mock.lastCall?.[0] as never)).toBe(1_000);
    expect(stop).not.toHaveBeenCalled();
  });

  it("keeps playing through an insert, which keeps the sources already there", async () => {
    const { session, output, clock, stop } = setup();
    connectOutput(session, output);
    await session.open(recording(1_000));
    await output.play();
    clock.advance(100);
    await session.insert(recording(500));
    expect(stop).not.toHaveBeenCalled();
    expect(output.getSnapshot().state).toBe("playing");
    expect(output.position()).toBe(100);
  });

  it("stops, back at the start, when another recording replaces this one", async () => {
    const { session, output, clock, stop } = setup();
    connectOutput(session, output);
    await session.open(recording(1_000));
    await output.play();
    clock.advance(400);
    await session.open(recording(2_000));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(output.getSnapshot().state).toBe("stopped");
    expect(output.position()).toBe(0);
    expect(planLength(session.getSnapshot().plan as never)).toBe(2_000);
  });

  it("stops when the recording closes", async () => {
    const { session, output, clock, stop } = setup();
    connectOutput(session, output);
    await session.open(recording(1_000));
    await output.play();
    clock.advance(200);
    await session.close();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(output.getSnapshot()).toEqual({ state: "stopped" });
  });

  it("loads what's already open when it connects, and stops following when disconnected", async () => {
    const { session, output, load } = setup();
    await session.open(recording(1_000));
    const disconnect = connectOutput(session, output);
    expect(load).toHaveBeenCalledTimes(1);
    disconnect();
    session.execute({
      type: "audio.setGain",
      keys: [session.getSnapshot().plan?.clips[0]?.key as string],
      gainDb: -3,
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("doesn't reload when only view state changes", async () => {
    const { session, output, load } = setup();
    connectOutput(session, output);
    await session.open(recording(1_000));
    const before = load.mock.calls.length;
    session.select({ start: 10, end: 20 });
    expect(load).toHaveBeenCalledTimes(before);
  });
});
