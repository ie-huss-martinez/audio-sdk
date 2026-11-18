import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";

/**
 * Playwright's `test`, with a guard against a crash in Firefox 159, as ui's
 * end-to-end tests have (ie-huss-martinez/ui#61, and this repository's #76).
 *
 * Firefox 159 crashes the page when an element's `ariaLabelledByElements` is
 * read from two JavaScript worlds. Playwright's role and label locators
 * read it from their isolated world to compute a name, and axe-core reads it
 * from the page's world, so a locator and an axe run on the same page crash
 * it, in either order.
 *
 * So in Firefox the property is removed from the page's world before any
 * script runs. axe then resolves `aria-labelledby` by ID, as it does in
 * browsers without the property, and reports the same results. The package
 * never reads the property, and Playwright's world keeps its own copy. This
 * comes out when sdk-config ships the guard, sdk-core's backlog item 2
 * ("Firefox ariaLabelledByElements guard"), or when Firefox fixes the crash.
 */
export const test = base.extend({
  page: async ({ page, browserName }, use) => {
    if (browserName === "firefox") {
      await page.addInitScript(() => {
        delete (Element.prototype as { ariaLabelledByElements?: unknown }).ariaLabelledByElements;
      });
    }
    await use(page);
  },
});
