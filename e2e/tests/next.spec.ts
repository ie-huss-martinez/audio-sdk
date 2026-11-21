import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../fixtures.js";
import { FIRST_OPEN, openByKeyboard, watch } from "./helpers.js";

const url = "http://localhost:4311/";
const origin = new URL(url).origin;

/**
 * The editor in a Next.js App Router application (sdk-core ADR 0007), as
 * pdf-sdk tests its own: a Server Component imports the server-safe entry
 * and renders the editor from the client entry, which hydrates without a
 * warning, works from the keyboard, passes axe and never reaches another
 * origin.
 */
test.describe("Next.js App Router", () => {
  test("renders the editor on the server", async ({ request }) => {
    const response = await request.get(url);
    expect(response.ok()).toBe(true);
    const html = await response.text();
    for (const marker of [
      // The server-safe entry ran in the Server Component.
      '<span data-testid="max-tracks">16</span>',
      'aria-label="Audio editor"',
      'role="toolbar"',
      'aria-label="Tools"',
      'data-hm-tool="audio.open"',
      "Drop an audio file here, or choose one. It stays on your device.",
      'aria-live="polite"',
    ]) {
      expect(html, marker).toContain(marker);
    }
  });

  test("hydrates without a warning, opens a recording and edits it from the keyboard", async ({
    page,
  }) => {
    const problems = watch(page, origin);
    await page.goto(url);
    await expect(page.locator("[data-hydrated]")).toBeAttached();

    // The toolbar is one tab stop.
    await expect(page.locator('[role="toolbar"][aria-label="Tools"] [tabindex="0"]')).toHaveCount(
      1,
    );

    await openByKeyboard(page, 1);
    const playhead = page.getByRole("slider", { name: "Playhead" });
    await expect(playhead).toBeFocused({ timeout: FIRST_OPEN });

    // A shortcut mutes the current track, and says so.
    await page.keyboard.press("m");
    await expect(page.locator(".hm-announcer [aria-live=polite]")).toHaveText("Track 1 muted.");
    await expect(page.getByRole("group", { name: "Track 1, muted" })).toBeAttached();
    await expect(playhead).toBeFocused();

    expect(problems.errors).toEqual([]);
    expect(problems.console).toEqual([]);
    expect(problems.foreignRequests).toEqual([]);
  });

  test("passes axe with no recording, and with one open", async ({ page }) => {
    await page.goto(url);
    await expect(page.locator("[data-hydrated]")).toBeAttached();
    const empty = await new AxeBuilder({ page }).include(".hm-audio-editor").analyze();
    expect(empty.violations).toEqual([]);

    await openByKeyboard(page, 1);
    await expect(page.getByRole("slider", { name: "Playhead" })).toBeFocused({
      timeout: FIRST_OPEN,
    });
    const ready = await new AxeBuilder({ page }).include(".hm-audio-editor").analyze();
    expect(ready.violations).toEqual([]);
  });
});
