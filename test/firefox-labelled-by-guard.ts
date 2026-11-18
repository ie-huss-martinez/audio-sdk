// A guard against a crash in Firefox 159 (ie-huss-martinez/ui#61, and this
// repository's #76): reading an element's `ariaLabelledByElements` from
// Playwright's isolated world and then from the page's world crashes the
// page. Vitest's `userEvent` builds Playwright locators, whose label engine
// reads it in the isolated world, and axe-core reads it in the page's world,
// so a click and an axe run on the same page crash Firefox, in either order.
//
// So in Firefox the property is removed from the page's world before any test
// runs, as ui's end-to-end tests do (ui/e2e/fixtures.ts). axe then resolves
// `aria-labelledby` by ID, as it does in browsers without the property, and
// reports the same results; Playwright's world keeps its own copy. The SDK
// never reads the property. It comes out when sdk-config ships the guard,
// sdk-core's backlog item 2 ("Firefox ariaLabelledByElements guard"), or
// when Firefox fixes the crash.
if (navigator.userAgent.includes("Firefox/")) {
  delete (Element.prototype as { ariaLabelledByElements?: unknown }).ariaLabelledByElements;
}
