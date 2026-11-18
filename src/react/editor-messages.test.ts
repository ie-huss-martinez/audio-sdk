import { uiMessages } from "@hussmartinez/ui";
import { describe, expect, it } from "vitest";
import { audioEditorText } from "../messages/editor-en.js";
import { audioMessages } from "../messages/en.js";
import { audioEditorMessages } from "./editor-messages.js";

describe("audioEditorMessages", () => {
  it("joins the SDK's, ui's and the editor's text, with no key in two of them", () => {
    const parts = [audioMessages, uiMessages, audioEditorText].map((part) => Object.keys(part));
    const all = parts.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(Object.keys(audioEditorMessages).sort()).toEqual([...all].sort());
  });

  it("keeps the editor's text out of the server-safe catalogue", () => {
    for (const key of Object.keys(audioEditorText)) expect(audioMessages).not.toHaveProperty(key);
  });
});
