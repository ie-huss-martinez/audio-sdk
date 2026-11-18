import { describe, expect, it } from "vitest";
import { createAudioAdapters, createAudioSession } from "../../src/index.js";

describe("createAudioAdapters", () => {
  it("makes an engine, a processor and an output, starting nothing", async () => {
    const adapters = createAudioAdapters({
      // Absolute: a test has no page to resolve a relative one against.
      assetsUrl: "https://app.example/audio-sdk/",
      idleTimeout: 1_000,
    });
    expect(Object.keys(adapters).sort()).toEqual(["destroy", "engine", "output", "processor"]);
    expect(adapters.output.getSnapshot()).toEqual({ state: "stopped" });
    // They go to a session as they are; the session takes no ownership.
    const session = createAudioSession({ engine: adapters.engine, processor: adapters.processor });
    await session.close();
    await adapters.destroy();
    // Destroyed together: each refuses what comes after.
    await expect(adapters.engine.probe(new Blob([]))).rejects.toThrow();
    await expect(adapters.output.play()).rejects.toThrow();
  });
});
