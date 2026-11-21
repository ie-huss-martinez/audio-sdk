import { applyVisualVariant, visualVariants } from "@hussmartinez/sdk-config/testing/visual";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures.js";
import { FIRST_OPEN, tone } from "../tests/helpers.js";

/**
 * The editor's designed states, as screenshots (sdk-core ADR 0048). Each is
 * captured in light and dark, compact and comfortable, on the built example
 * as a host renders it.
 *
 * | State | What it shows |
 * |---|---|
 * | `empty` | The drop zone, before a recording is open |
 * | `open` | One recording on its track: the toolbar, the timeline with its waveform, the transport and the inspector's Recording section |
 * | `tracks` | Two tracks, the second muted, with a clip of the first selected and the inspector's Clip section |
 * | `selection` | A range on the first of two tracks, with Ripple's warning on its lane and header, the transport's text and the inspector's Selection section |
 * | `rename` | The rename dialog, its field focused |
 * | `export-summary` | The export dialog's summary, naming the muted track, and its formats with their sizes |
 * | `export-done` | The export dialog's result for a mix that clipped, with the clipping report and Download focused |
 * | `error` | A file that isn't audio, and the catalogue's text for it |
 * | `element-empty`, `element-open` | `<hm-audio-editor>`, whose styles arrive through the host's imports |
 * | `long-text`, `long-text-rename`, `long-text-export` | A host's longer text, as a translation can be: two tracks with a clip selected, the rename dialog and the export dialog wrap it |
 * | `rtl`, `rtl-selection` | A Hebrew host, right to left: two tracks, the second muted, with a clip of the first selected, and a range on the first. Time runs from the right, and the icons that point along time are mirrored |
 * | `rtl-dir-only` | `tracks` on a page that sets only `dir="rtl"`, with English text, so a rule keyed on a right-to-left `lang` can't stand in for one keyed on direction |
 *
 * No state is masked: every one renders generated tones at a fixed time,
 * the waveform is drawn from their peaks, and the editor shows no time or
 * random value that varies between runs.
 */

/** A fixed time, so nothing that reads the clock can vary (ADR 0048). */
const NOW = new Date("2026-11-18T12:00:00Z");

type State = (page: Page) => Promise<void>;

const open = async (page: Page, bytes: Buffer) => {
  await page.evaluate((data) => window.audioEditor.open(new Uint8Array(data).buffer), [...bytes]);
};
const insert = async (page: Page, bytes: Buffer) => {
  await page.evaluate((data) => window.audioEditor.insert(new Uint8Array(data).buffer), [...bytes]);
};
const clipsShown = (page: Page, count: number) =>
  expect(page.getByRole("option")).toHaveCount(count, { timeout: FIRST_OPEN });

/** Two tracks: a 2 s tone, and a 1 s one under it, muted. */
const twoTracks = async (page: Page, amplitude?: number) => {
  await open(page, tone(2, amplitude));
  await insert(page, tone(1, amplitude));
  await clipsShown(page, 2);
};
const muteSecond = async (page: Page) => {
  const header = page.getByRole("toolbar", { name: "Track 2" });
  await header.getByRole("button", { name: "Mute" }).click();
  await expect(page.getByRole("group", { name: "Track 2, muted" })).toBeAttached();
};

/** Two tracks, the second muted, with a clip of the first selected. */
const tracks: State = async (page) => {
  await twoTracks(page);
  await muteSecond(page);
  await page.getByRole("option").first().focus();
  await expect(page.getByText("Clip on Track 1")).toBeVisible();
};

const EDITOR: Readonly<Record<string, State>> = {
  empty: async (page) => {
    await expect(page.getByRole("button", { name: "Choose a file" })).toBeVisible();
  },
  open: async (page) => {
    await open(page, tone(2));
    await expect(page.getByRole("slider", { name: "Playhead" })).toBeFocused({
      timeout: FIRST_OPEN,
    });
  },
  tracks,
  selection: async (page) => {
    await twoTracks(page);
    // Drag across the first track's clip, from a quarter to three quarters of it.
    const box = await page.getByRole("option").first().boundingBox();
    if (!box) throw new Error("no clip");
    const y = box.y + box.height - 4;
    await page.mouse.move(box.x + box.width / 4, y);
    await page.mouse.down();
    await page.mouse.move(box.x + (box.width * 3) / 4, y, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator(".hm-audio-editor-selection")).toContainText("on Track 1");
    await expect(page.locator(".hm-audio-editor-track-ripple")).toHaveText("Ripple");
  },
  rename: async (page) => {
    await open(page, tone(2));
    await clipsShown(page, 1);
    await page.getByRole("button", { name: "Track 1, rename" }).click();
    await expect(page.getByRole("dialog").getByRole("textbox")).toBeFocused();
  },
  "export-summary": async (page) => {
    await twoTracks(page);
    await muteSecond(page);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await expect(dialog.getByText("Track 2 is muted, so it won't be in the file.")).toBeVisible();
  },
  "export-done": async (page) => {
    await twoTracks(page, 0.9);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Download" })).toBeFocused({
      timeout: FIRST_OPEN,
    });
    await expect(dialog.getByText(/The mix went .* dB over full scale/)).toBeVisible();
  },
  error: async (page) => {
    await open(page, Buffer.from([1, 2, 3, 4])).catch(() => {});
    await expect(page.locator(".hm-audio-editor-error")).toBeVisible({ timeout: FIRST_OPEN });
  },
};

const ELEMENT: Readonly<Record<string, State>> = {
  "element-empty": async (page) => {
    await expect(page.getByRole("button", { name: "Choose a file" })).toBeVisible();
  },
  "element-open": async (page) => {
    await page.evaluate(
      (bytes) => {
        const editor = document.querySelector("hm-audio-editor") as HTMLElement & { file?: Blob };
        editor.file = new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
      },
      [...tone(2)],
    );
    await clipsShown(page, 1);
  },
};

/** The same states, with the example's `?long-text` overrides, as a translation's text. */
const LONG_TEXT: Readonly<Record<string, State>> = {
  "long-text": async (page) => {
    await twoTracks(page);
    await page.getByRole("option").first().focus();
    await expect(page.getByText("Clip on Tonspur Nummer 1")).toBeVisible();
  },
  "long-text-rename": async (page) => {
    await open(page, tone(2));
    await clipsShown(page, 1);
    await page.getByRole("button", { name: "Tonspur Nummer 1, rename" }).click();
    await expect(page.getByRole("dialog").getByRole("textbox")).toBeFocused();
  },
  "long-text-export": async (page) => {
    await twoTracks(page);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Aufnahme als Datei exportieren" }),
    ).toBeVisible();
  },
};

/** The example's `?lang=he`: a Hebrew host, right to left. */
const HEBREW: Readonly<Record<string, State>> = {
  rtl: async (page) => {
    await expect(page.locator("html")).toHaveAttribute("lang", "he");
    await twoTracks(page);
    const header = page.getByRole("toolbar", { name: "רצועה 2" });
    await header.getByRole("button", { name: "השתקה" }).click();
    await expect(page.getByRole("group", { name: "רצועה 2, מושתקת" })).toBeAttached();
    await page.getByRole("option").first().focus();
    await expect(page.getByText("קטע ברצועה 1")).toBeVisible();
  },
  "rtl-selection": async (page) => {
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await twoTracks(page);
    // Across the first track's clip, from a quarter to three quarters of it.
    const box = await page.getByRole("option").first().boundingBox();
    if (!box) throw new Error("no clip");
    const y = box.y + box.height - 4;
    await page.mouse.move(box.x + box.width / 4, y);
    await page.mouse.down();
    await page.mouse.move(box.x + (box.width * 3) / 4, y, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator(".hm-audio-editor-selection")).toContainText("רצועה 1");
    await expect(page.locator(".hm-audio-editor-track-ripple")).toHaveText("Ripple");
  },
};

/** The example's `?dir=rtl`: only `dir`, no right-to-left `lang`. */
const DIR_ONLY: Readonly<Record<string, State>> = {
  "rtl-dir-only": async (page) => {
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await tracks(page);
  },
};

for (const [path, states] of [
  ["/editor.html", EDITOR],
  ["/editor.html?long-text", LONG_TEXT],
  ["/editor.html?lang=he", HEBREW],
  ["/editor.html?dir=rtl", DIR_ONLY],
  ["/element.html", ELEMENT],
] as const) {
  for (const [state, reach] of Object.entries(states)) {
    for (const variant of visualVariants) {
      test(`${state}, ${variant.name}`, async ({ page }) => {
        // No request may leave the page's origin (sdk-core ADR 0012).
        const foreign: string[] = [];
        page.on("request", (request) => {
          const url = new URL(request.url());
          if (!["http:", "https:"].includes(url.protocol)) return;
          if (url.origin !== "http://localhost:4310") foreign.push(request.url());
        });
        await page.clock.install({ time: NOW });
        await page.goto(path);
        await applyVisualVariant(page, variant);
        await reach(page);
        // The pointer rests outside the editor, so no hover styles show.
        await page.mouse.move(0, 0);
        await expect(page).toHaveScreenshot(`${state}-${variant.name}.png`);
        expect(foreign).toEqual([]);
      });
    }
  }
}
