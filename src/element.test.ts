import { describe, expect, it } from "vitest";

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
