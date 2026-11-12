import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  type Browser,
  cell,
  FORMATS,
  IN_PINNED_IMAGE,
  RESULTS,
  readTable,
} from "../capabilities.js";

const table = readTable();
const update = Boolean(process.env["UPDATE_CAPABILITIES"]);

/** Requests the page makes to any other origin: the SDK must make none (ADR 0012 in sdk-core). */
function foreignRequests(page: Page): string[] {
  const foreign: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== "http://localhost:4310") {
      foreign.push(request.url());
    }
  });
  return foreign;
}

for (const format of FORMATS) {
  for (const selfHosted of [false, true]) {
    const mode = selfHosted ? "self-hosted" : "inline";
    test(`${format.name} (${mode})`, async ({ page, browserName, browser }) => {
      const foreign = foreignRequests(page);
      await page.goto("/");
      const bytes = Array.from(format.bytes());
      const outcome = await page.evaluate(
        ([data, hosted]) => window.audioSdk.run(new Uint8Array(data).buffer, hosted),
        [bytes, selfHosted] as const,
      );

      // Whatever the browser does, the engine never returns more than the bound.
      if (outcome.status === "decoded") {
        expect(outcome.frames).toBeGreaterThan(0);
        expect(outcome.frames).toBeLessThanOrEqual(outcome.bound ?? 0);
        expect(outcome.levels).toBeGreaterThan(0);
      } else {
        // Only the browser's decoder may refuse a format, by failing or by
        // never finishing, which the time limit stops (sdk-core ADR 0031).
        expect(["DECODE_FAILED", "TIMEOUT"]).toContain(outcome.status);
      }
      expect(foreign).toEqual([]);

      const observed = cell(outcome.status);
      if (update) {
        if (!selfHosted) {
          mkdirSync(RESULTS, { recursive: true });
          const slug = `${browserName}-${format.name.replace(/[^\w]+/g, "-")}.json`;
          writeFileSync(
            new URL(slug, RESULTS),
            JSON.stringify({
              browser: browserName,
              version: browser.version(),
              format: format.name,
              cell: observed,
            }),
          );
        }
        return;
      }
      if (!IN_PINNED_IMAGE) {
        // The table describes the pinned image's engines; this host's may
        // have other codecs. The checks above still apply.
        test.info().annotations.push({
          type: "capabilities",
          description: `${browserName}: ${observed}; compared with docs/capabilities.md only in the pinned image`,
        });
        return;
      }
      const expected = table.get(format.name)?.[browserName as Browser];
      expect(
        observed,
        `${format.name} in ${browserName} differs from docs/capabilities.md; regenerate it as the file explains, and review the difference`,
      ).toBe(expected);
    });
  }
}
