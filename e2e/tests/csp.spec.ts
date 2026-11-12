import { expect, test } from "@playwright/test";
import { wavFile } from "../../test/fixtures/pcm-files.js";

/**
 * The self-hosted worker under a Content Security Policy with
 * `worker-src 'self'` and no `blob:` (docs/adr/0002): the built example's
 * strict.html sets it, as a host would.
 */
test.describe("a strict Content Security Policy", () => {
  const bytes = Array.from(wavFile([[0.1, 0.2, 0.3, 0.4]], { format: "float32" }));

  test("lets the self-hosted worker decode, with no violation", async ({ page }) => {
    await page.goto("/strict.html");
    const outcome = await page.evaluate(
      (data) => window.audioSdk.run(new Uint8Array(data).buffer, true),
      bytes,
    );
    expect(outcome).toMatchObject({ status: "decoded", frames: 4 });
    expect(await page.evaluate(() => window.audioSdk.violations)).toEqual([]);
  });

  test("blocks the inlined worker, which starts from a blob: URL", async ({ page }) => {
    await page.goto("/strict.html");
    const outcome = await page.evaluate(
      (data) => window.audioSdk.run(new Uint8Array(data).buffer, false),
      bytes,
    );
    expect(outcome.status).toMatch(/^WORKER_/);
    await expect
      .poll(() => page.evaluate(() => window.audioSdk.violations))
      .toContainEqual(expect.stringMatching(/^worker-src blob/));
  });
});
