import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures.js";
import { arrowTo, openByKeyboard, tabTo } from "./helpers.js";

/**
 * The keyboard-only path through the editor (docs/adr/0005, "Tests"): open
 * through the drop zone's button, move the playhead, select a range with I
 * and O, delete it, split, trim with the bracket keys, set a fade, undo,
 * play and pause, and export. Each step checks where focus is, and nothing
 * is clicked.
 */

type Clip = { key: string; at: number; start: number; end: number; fadeIn: { frames: number } };
type Plan = { tracks: { clips: Clip[] }[] };
const clips = (page: Page) =>
  page.evaluate(() => (window.audioEditor.plan() as Plan | null)?.tracks[0]?.clips ?? []);
const focusedKey = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset["hmKey"]);

/** Shift+Tab back into the toolbar, then Home and the arrows to a tool: it's one tab stop. */
async function toTool(page: Page, tool: Locator) {
  const toolbar = page.getByRole("toolbar", { name: "Tools" });
  for (let i = 0; i < 60; i += 1) {
    if (await toolbar.evaluate((element) => element.contains(document.activeElement))) break;
    await page.keyboard.press("Shift+Tab");
  }
  await page.keyboard.press("Home");
  await arrowTo(page, tool);
}

test("edits and exports with the keyboard alone, with focus where it belongs", async ({
  page,
  browserName,
}) => {
  await page.goto("/editor.html");
  const playhead = page.getByRole("slider", { name: "Playhead" });

  // Open through the drop zone's button: focus goes to the playhead.
  await openByKeyboard(page, 3);
  await expect(playhead).toBeFocused({ timeout: 20_000 });
  expect((await clips(page)).map((clip) => clip.end)).toEqual([24_000]);

  // Move the playhead, and select from 1 s to 2 s with I and O.
  await page.keyboard.press("PageUp");
  await expect(playhead).toHaveAttribute("aria-valuetext", "0:01.00");
  await page.keyboard.press("i");
  await page.keyboard.press("PageUp");
  await page.keyboard.press("o");
  const selection = page.locator(".hm-audio-editor-selection");
  await expect(selection).toHaveText("Selected 0:01.00 to 0:02.00 on Track 1");
  await expect(playhead).toBeFocused();

  // Delete it: Ripple closes the gap, and the playhead takes focus at its start.
  await page.keyboard.press("Delete");
  await expect
    .poll(async () => (await clips(page)).map((clip) => [clip.at, clip.end - clip.start]))
    .toEqual([
      [0, 8_000],
      [8_000, 8_000],
    ]);
  await expect(playhead).toBeFocused();
  await expect(playhead).toHaveAttribute("aria-valuetext", "0:01.00");

  // Split at 0.5 s: focus goes to the part after the playhead.
  await page.keyboard.press("PageDown");
  for (let i = 0; i < 50; i += 1) await page.keyboard.press("ArrowRight");
  await expect(playhead).toHaveAttribute("aria-valuetext", "0:00.50");
  await page.keyboard.press("s");
  await expect.poll(async () => (await clips(page)).length).toBe(3);
  const after = (await clips(page))[1] as Clip;
  expect(after.at).toBe(4_000);
  await expect.poll(() => focusedKey(page)).toBe(after.key);

  // Trim with the bracket keys: Alt+[ shortens the clip's start by 10 ms.
  await page.keyboard.press("Alt+BracketLeft");
  await expect.poll(async () => (await clips(page))[1]?.at).toBe(4_080);
  await expect.poll(() => focusedKey(page)).toBe(after.key);

  // Set a fade from the toolbar, on the selected clip, then undo it.
  const fadeIn = page.getByRole("button", { name: "Fade in", exact: true });
  await toTool(page, fadeIn);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await clips(page))[1]?.fadeIn.frames).toBe(3_920);
  await expect(fadeIn).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await clips(page))[1]?.fadeIn.frames).toBe(0);
  await expect(fadeIn).toBeFocused();

  // Play and pause with the transport's button. Firefox in the test image
  // has no sound server, so its audio never starts, and its label check is
  // skipped there (sdk-core ADR 0043:
  // https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0043-no-audio-output-in-firefox-tests.md).
  const hasAudioOutput = browserName !== "firefox";
  const play = page.getByRole("button", { name: "Play", exact: true });
  await tabTo(page, play);
  if (hasAudioOutput) {
    await page.keyboard.press("Space");
    const pause = page.getByRole("button", { name: "Pause", exact: true });
    await expect(pause).toBeFocused();
    await page.keyboard.press("Space");
    await expect(play).toBeFocused();
  }

  // Export: the dialog's summary, then Download, which gets focus.
  await toTool(page, page.getByRole("button", { name: "Export", exact: true }));
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Export" });
  await expect(dialog.getByText("0:02.00 long, at 8,000 Hz, Mono.")).toBeVisible();
  await tabTo(page, dialog.getByRole("button", { name: "Export", exact: true }));
  await page.keyboard.press("Enter");
  const download = dialog.getByRole("button", { name: "Download" });
  await expect(download).toBeFocused();
  const saved = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  expect((await saved).suggestedFilename()).toBe("recording.wav");
});
