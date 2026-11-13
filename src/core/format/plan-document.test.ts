import { describe, expect, it } from "vitest";
import { EMPTY_METADATA, NO_FADE } from "../model/plan.js";
import { readAudioPlanDocument, toAudioPlanDocument } from "./plan-document.js";

const clip = {
  key: "a",
  source: "s1",
  start: 0,
  end: 10,
  gainDb: 0,
  fadeIn: NO_FADE,
  fadeOut: NO_FADE,
};
const plan = { sampleRate: 8_000, channels: 1, clips: [clip], metadata: EMPTY_METADATA };

describe("plan documents", () => {
  it("round-trip through JSON text", () => {
    const document = toAudioPlanDocument(plan, { s1: { frames: 10 } });
    const read = readAudioPlanDocument(JSON.parse(JSON.stringify(document)));
    expect(read.plan).toEqual(plan);
    expect(read.sources).toEqual({ s1: { frames: 10 } });
  });

  it("won't write a plan without the sources its clips use", () => {
    expect(() => toAudioPlanDocument(plan, {})).toThrow(TypeError);
  });

  it("reads a source id of __proto__ as an id, without touching prototypes", () => {
    const document = toAudioPlanDocument(plan, { s1: { frames: 10 } });
    const text = JSON.stringify({ ...document, clips: [{ ...clip, source: "__proto__" }] });
    // JSON.parse makes "__proto__" an own property, as a hostile file would.
    const hostile = JSON.parse(
      text.replace('"sources":{"s1":{"frames":10}}', '"sources":{"__proto__":{"frames":10}}'),
    );
    const { sources } = readAudioPlanDocument(hostile);
    expect(Object.hasOwn(sources, "__proto__")).toBe(true);
    expect(({} as { frames?: unknown }).frames).toBeUndefined();
  });

  it("checks an id the document's sources only inherit as unknown", () => {
    const document = toAudioPlanDocument(
      { ...plan, clips: [{ ...clip, source: "toString" }] },
      {
        toString: { frames: 10 },
      },
    );
    const { toString: _, ...withoutIt } = document.sources;
    expect(() => readAudioPlanDocument({ ...document, sources: withoutIt })).toThrow(
      expect.objectContaining({
        code: "INVALID_DOCUMENT",
        details: expect.objectContaining({ reason: "unknown-source" }),
      }),
    );
  });
});
