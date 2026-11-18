import { defineVisualConfig } from "@hussmartinez/sdk-config/testing/visual";

/**
 * Visual regression tests of the editor and the element on the built Vite
 * example (sdk-core ADR 0048): Chromium, in the pinned browser test image
 * only. Run them with `pnpm test:visual`, and rewrite the baselines with
 * `pnpm test:visual:update`, never with playwright directly.
 */
export default defineVisualConfig({
  baseURL: "http://localhost:4310",
  // Started with Node directly, as the end-to-end suite's server is.
  webServer: {
    command: "node node_modules/vite/bin/vite.js preview --port 4310 --strictPort",
    cwd: "../examples/vite",
    url: "http://localhost:4310",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
