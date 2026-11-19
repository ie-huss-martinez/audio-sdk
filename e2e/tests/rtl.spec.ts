import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures.js";
import { tone } from "./helpers.js";

/**
 * The icons that point along time mirror in right-to-left text, in the
 * built example as a host's Vite build ships ui's stylesheet. A minifier
 * can rewrite `:dir(rtl)` for older browsers as a list of right-to-left
 * languages, which a page that sets only `dir` never matches, so `?dir=rtl`
 * has no `lang` of its own. Each flagged icon is checked by its computed
 * transform, not by eye.
 */

/** The icons ui flags to mirror, as the editor shows them with a recording open. */
const FLAGGED = [
  "undo",
  "redo",
  "trim-start",
  "trim-end",
  "fade-in",
  "fade-out",
  "chevron-left",
  "chevron-right",
  "range-start",
  "range-end",
  "skip-back",
];
const MIRRORED = "matrix(-1, 0, 0, 1, 0, 0)";

/** Each icon's name, whether ui flags it, and its computed transform. */
async function icons(page: Page) {
  await page.evaluate((data) => window.audioEditor.open(new Uint8Array(data).buffer), [...tone(1)]);
  await expect(page.getByRole("option")).toHaveCount(1, { timeout: 20_000 });
  return page.locator("svg.hm-icon").evaluateAll((all) =>
    all.map((icon) => ({
      name: icon.getAttribute("data-hm-icon"),
      flagged: icon.hasAttribute("data-hm-mirror"),
      transform: getComputedStyle(icon).transform,
    })),
  );
}

for (const [path, what] of [
  ["/editor.html?dir=rtl", "only dir"],
  ["/editor.html?lang=he", "a Hebrew lang and dir"],
] as const) {
  test(`the icons that point along time mirror on a page with ${what}`, async ({ page }) => {
    await page.goto(path);
    const shown = await icons(page);
    const flagged = shown.filter((icon) => icon.flagged);
    expect(new Set(flagged.map((icon) => icon.name))).toEqual(new Set(FLAGGED));
    for (const icon of flagged) expect(icon.transform, icon.name ?? "").toBe(MIRRORED);
    // Play, add, delete and the rest read the same either way.
    for (const icon of shown.filter((each) => !each.flagged)) {
      expect(icon.transform, icon.name ?? "").toBe("none");
    }
  });
}

test("no icon mirrors on a left-to-right page", async ({ page }) => {
  await page.goto("/editor.html");
  for (const icon of await icons(page)) expect(icon.transform, icon.name ?? "").toBe("none");
});
