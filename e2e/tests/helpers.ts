import type { Locator, Page } from "@playwright/test";
import { wavFile } from "../../test/fixtures/pcm-files.js";

/** A tone at 8 kHz, as WAV bytes: `seconds` long, quiet enough never to clip. */
export function tone(seconds: number): Buffer {
  const samples = Array.from({ length: 8_000 * seconds }, (_, i) => Math.sin(i / 9) * 0.25);
  return Buffer.from(wavFile([samples]));
}

/** Presses Tab, or Shift+Tab, until the locator has focus, as a person would. */
export async function tabTo(page: Page, target: Locator, backwards = false): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press(backwards ? "Shift+Tab" : "Tab");
  }
  throw new Error(`Tab never reached ${target}`);
}

/** Presses an arrow key within a toolbar until the locator has focus. */
export async function arrowTo(page: Page, target: Locator, key = "ArrowRight"): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press(key);
  }
  throw new Error(`${key} never reached ${target}`);
}

/** Opens a recording through the drop zone's button, with the keyboard. */
export async function openByKeyboard(page: Page, seconds: number, name = "take.wav") {
  await tabTo(page, page.getByRole("button", { name: "Choose a file" }));
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles({ name, mimeType: "audio/wav", buffer: tone(seconds) });
}

/** What went wrong on a page: errors, console messages and requests to another origin. */
export function watch(page: Page, origin: string) {
  const problems = {
    errors: [] as string[],
    console: [] as string[],
    foreignRequests: [] as string[],
  };
  page.on("pageerror", (error) => problems.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      problems.console.push(message.text());
    }
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== origin) {
      problems.foreignRequests.push(request.url());
    }
  });
  return problems;
}
