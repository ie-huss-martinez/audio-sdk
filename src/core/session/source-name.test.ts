import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cleanFileName, MAX_NAME_LENGTH } from "./source-name.js";

describe("cleanFileName (pdf-sdk ADR 0009)", () => {
  it.each([
    ["report.pdf", "report.pdf"],
    ["  Quarterly report.pdf  ", "Quarterly report.pdf"],
    ["../../etc/passwd", "passwd"],
    ["C:\\Users\\me\\report.pdf", "report.pdf"],
    ["folder/sub\\mixed.pdf", "mixed.pdf"],
    ["re\u0000po\u0007rt\u007F\u0085.pdf", "report.pdf"],
    ["line\nbreak\r\t.pdf", "linebreak.pdf"],
    // A right-to-left override that would show "invoice\u202Efdp.exe" as "invoiceexe.pdf".
    ["invoice\u202Efdp.exe", "invoicefdp.exe"],
    ["a\u2066b\u2069c\u200Ed\u200Fe\u061Cf.pdf", "abcdef.pdf"],
    ['a<b>c:d"e|f?g*h.pdf', "abcdefgh.pdf"],
    [".hidden.pdf", "hidden.pdf"],
    ["... . .pdf", "pdf"],
    // NFC: "e" and a combining acute accent become one "é".
    ["re\u0301sume\u0301.pdf", "résumé.pdf"],
    ["文書.pdf", "文書.pdf"],
  ])("cleans %j to %j", (raw, clean) => {
    expect(cleanFileName(raw)).toBe(clean);
  });

  it.each([[""], ["   "], ["..."], ["/"], ["a/"], ["\u0000\u202E"], ['<>:"|?*']])(
    "gives no name for %j",
    (raw) => {
      expect(cleanFileName(raw)).toBeUndefined();
    },
  );

  it("removes a right-to-left override that disguises an extension", () => {
    // Shown as "invoiceexe.pdf", but it's an .exe.
    const disguised = "invoice\u202Efdp.exe";
    const clean = cleanFileName(disguised) as string;
    expect(clean).toBe("invoicefdp.exe");
    expect(clean).not.toContain("\u202E");
    expect(clean.endsWith(".exe")).toBe(true);
  });

  it("gives no name for anything that isn't a string", () => {
    for (const value of [undefined, null, 42, {}, ["a.pdf"], new String("a.pdf")]) {
      expect(cleanFileName(value)).toBeUndefined();
    }
  });

  it("caps the length in code points, never splitting a surrogate pair", () => {
    const long = "😀".repeat(MAX_NAME_LENGTH + 10);
    const clean = cleanFileName(long) as string;
    expect(Array.from(clean)).toHaveLength(MAX_NAME_LENGTH);
    expect(clean).toBe("😀".repeat(MAX_NAME_LENGTH));
    expect(cleanFileName("a".repeat(MAX_NAME_LENGTH))).toHaveLength(MAX_NAME_LENGTH);
  });

  // fast-check's default 100 runs, over strings of up to 400 code units.
  // That's work, not waiting: 1.1 to 1.3 s on its own, but 6.7 s with the
  // machine at a load of about 31, over the default 5 s. The runs stay; the
  // limit allows 30 s.
  it("always gives a safe name, or none, for any string", { timeout: 30_000 }, () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 400 }), (raw) => {
        const clean = cleanFileName(raw);
        if (clean === undefined) return;
        expect(clean).not.toBe("");
        expect(clean).not.toMatch(
          /[/\\<>:"|?*\p{Cc}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u,
        );
        expect(clean).not.toMatch(/^[\s.]|\s$/u);
        expect(Array.from(clean).length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
        expect(clean).toBe(clean.normalize("NFC"));
        // Cleaning is stable: a clean name stays as it is.
        expect(cleanFileName(clean)).toBe(clean);
      }),
    );
  });
});
