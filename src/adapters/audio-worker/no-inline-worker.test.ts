import { describe, expect, it, vi } from "vitest";
import { isAudioError } from "../../core/errors/audio-error.js";
import { EMPTY_METADATA } from "../../core/model/plan.js";
import { createInlineWorker } from "./no-inline-worker.js";

// A build with the hm-self-hosted condition gets this module instead of the
// inlined worker (sdk-core ADR 0060).
vi.mock("#hm-audio-inline-worker", () => import("./no-inline-worker.js"));

const leftOut = (error: unknown) =>
  isAudioError(error, "WORKER_START_FAILED") &&
  error.message.includes("hm-self-hosted") &&
  error.message.includes("assetsUrl") &&
  JSON.stringify(error.details) ===
    JSON.stringify({ condition: "hm-self-hosted", missing: "assetsUrl" });

describe("the stub for a build without the inlined worker (sdk-core ADR 0060)", () => {
  it("refuses to start the worker, naming the condition and the missing assetsUrl", () => {
    expect(() => createInlineWorker()).toThrow(
      expect.toSatisfy(leftOut, "WORKER_START_FAILED naming hm-self-hosted and assetsUrl"),
    );
  });

  it("reaches an engine's caller unchanged, when a build needs the inlined worker", async () => {
    const { createAudioEngine } = await import("../audio-engine.js");
    const engine = createAudioEngine();
    try {
      await expect(engine.probe(new Blob([new Uint8Array(64)]))).rejects.toSatisfy(leftOut);
    } finally {
      await engine.destroy();
    }
  });

  it("reaches a processor's caller unchanged, too", async () => {
    const { createAudioProcessor } = await import("../audio-processor.js");
    const processor = createAudioProcessor();
    try {
      await expect(
        processor.render({
          plan: { sampleRate: 8_000, channels: 1, gainDb: 0, metadata: EMPTY_METADATA, tracks: [] },
          sources: new Map(),
          format: { container: "wav" },
        }),
      ).rejects.toSatisfy(leftOut);
    } finally {
      await processor.destroy();
    }
  });
});
