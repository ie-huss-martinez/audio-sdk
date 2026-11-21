import { describe, expect, it } from "vitest";
import { exportFileName } from "./export-name.js";

// The cleaning itself is the family's, tested in src/core/session; these
// are the steps the export adds after it, as video-sdk's do.
describe("the export's file name", () => {
  it("is the host's name, else the title, else recording", () => {
    expect(exportFileName("Interview", "Take 1")).toBe("Interview");
    expect(exportFileName(undefined, "Take 1")).toBe("Take 1");
    expect(exportFileName("", "")).toBe("recording");
    expect(exportFileName("  ", "...")).toBe("recording");
    // A name that cleans to nothing falls back too.
    expect(exportFileName("\u202e", "Take 1")).toBe("Take 1");
  });

  it("is cleaned as the family cleans a file name: the last path segment", () => {
    expect(exportFileName("Shows/episode 1.wav", "")).toBe("episode 1");
    expect(exportFileName("C:\\Users\\me\\take.mp3", "")).toBe("take");
  });

  it("drops an audio extension the host left on, as the export adds its own", () => {
    expect(exportFileName("interview.WAV", "")).toBe("interview");
    expect(exportFileName("take.final.flac", "")).toBe("take.final");
    expect(exportFileName("notes.txt", "")).toBe("notes.txt");
    // What's left is cleaned again: no trailing space, and nothing left is none.
    expect(exportFileName("interview .ogg", "")).toBe("interview");
    expect(exportFileName("x/.m4a", "Take 1")).toBe("m4a");
  });

  it("cleans the title as it cleans a name", () => {
    expect(exportFileName(undefined, 'Take 1: "the studio"')).toBe("Take 1 the studio");
    expect([...exportFileName(undefined, "\u{1F3B5}".repeat(200))]).toHaveLength(128);
  });

  it("drops half a surrogate pair, which isn't text, and keeps a whole one", () => {
    expect(exportFileName("take\uD83D.wav", "")).toBe("take");
    expect(exportFileName(undefined, "\uDE00Song \u{1F3B5}")).toBe("Song \u{1F3B5}");
  });
});
