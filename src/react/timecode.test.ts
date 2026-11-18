import { describe, expect, it } from "vitest";
import { formatTimecode } from "../core/model/time.js";
import { parseTimecode } from "./timecode.js";

describe("parseTimecode", () => {
  it("reads what formatTimecode writes, back to the frame at hundredths", () => {
    for (const frames of [0, 8_000, 12_340, 3_600 * 8_000 + 41_600]) {
      const text = formatTimecode(frames, 8_000);
      expect(parseTimecode(text, 8_000)).toBe(Math.floor((frames * 100) / 8_000) * 80);
    }
  });

  it("reads plain seconds and minutes, with spaces around", () => {
    expect(parseTimecode(" 12.4 ", 8_000)).toBe(99_200);
    expect(parseTimecode(".5", 8_000)).toBe(4_000);
    expect(parseTimecode("2:00", 8_000)).toBe(960_000);
    expect(parseTimecode("1:02:05.00", 1)).toBe(3_725);
  });

  it("refuses anything else", () => {
    for (const text of ["", "abc", "-1", "1:60.00", "1:60:00", "1e3", "1:2:3:4", "0:1.2.3"]) {
      expect(parseTimecode(text, 8_000)).toBeUndefined();
    }
  });
});
