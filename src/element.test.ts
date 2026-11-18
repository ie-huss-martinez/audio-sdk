import { describe, expect, it, vi } from "vitest";

// Imports the whole element entry inside the test: image-sdk measured it
// under 1 s alone and past 5 s on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

describe("the element entry on a server (sdk-core ADR 0007)", () => {
  it("does nothing on import, and can't define the element without custom elements", async () => {
    expect(globalThis.customElements).toBeUndefined();
    const { defineAudioEditorElement } = await import("./element.js");
    expect(globalThis.customElements).toBeUndefined();
    expect(() => defineAudioEditorElement()).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_ENVIRONMENT" }),
    );
  });
});
