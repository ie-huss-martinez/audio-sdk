import { expect, test } from "../fixtures.js";
import { FIRST_OPEN, openByKeyboard } from "./helpers.js";

/**
 * `<hm-audio-editor>` on a page without React of its own (docs/adr/0005):
 * it opens a recording from the keyboard, edits it with a shortcut, and its
 * events never carry the file's name.
 */
test("the element opens and edits a recording from the keyboard, with anonymous events", async ({
  page,
}) => {
  await page.goto("/element.html");
  await openByKeyboard(page, 1, "private-interview.wav");
  const playhead = page.getByRole("slider", { name: "Playhead" });
  await expect(playhead).toBeFocused({ timeout: FIRST_OPEN });

  await page.keyboard.press("m");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.audioElementEvents.some(
          (event) => event.name === "change" && event.json.includes('"muted":true'),
        ),
      ),
    )
    .toBe(true);
  await expect(playhead).toBeFocused();

  const events = await page.evaluate(() => window.audioElementEvents);
  expect(events.some((event) => event.name === "event")).toBe(true);
  for (const event of events) expect(event.json).not.toContain("private-interview");
});
