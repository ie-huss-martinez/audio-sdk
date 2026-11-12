import { defineConfig, devices } from "@playwright/test";

const ci = Boolean(process.env["CI"]);
// Regenerating docs/capabilities.md needs every engine.
const allBrowsers = ci || Boolean(process.env["UPDATE_CAPABILITIES"]);

/**
 * End-to-end tests against the built Vite example: the codec capability
 * matrix of docs/adr/0001, no request to another origin (ADR 0012 in
 * sdk-core), and the self-hosted worker under a strict Content Security
 * Policy (docs/adr/0002). Chromium locally, all three engines in CI, as for
 * the other browser tests.
 */
export default defineConfig({
  testDir: "tests",
  forbidOnly: ci,
  retries: 0,
  reporter: ci ? "line" : "list",
  globalTeardown: "./update-capabilities.ts",
  use: { baseURL: "http://localhost:4310", trace: "retain-on-failure" },
  projects: (
    [
      ["chromium", "Desktop Chrome"],
      ["firefox", "Desktop Firefox"],
      ["webkit", "Desktop Safari"],
    ] as const
  )
    .filter(([name]) => allBrowsers || name === "chromium")
    .map(([name, device]) => ({ name, use: { ...devices[device] } })),
  webServer: {
    command: "pnpm --filter @hussmartinez/audio-sdk-example-vite start",
    url: "http://localhost:4310",
    reuseExistingServer: !ci,
    timeout: 60_000,
  },
});
