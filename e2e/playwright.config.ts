import { browserTestImageProblem } from "@hussmartinez/sdk-config/testing/require-image";
import { defineConfig, devices } from "@playwright/test";

const ci = Boolean(process.env["CI"]);
// Regenerating docs/capabilities.md needs every engine.
const allBrowsers = ci || Boolean(process.env["UPDATE_CAPABILITIES"]);
// Playwright starts the web servers before the global setup, so outside the
// image none starts: the guard's explanation comes first, not a server's
// failure. Inside the image and in CI, nothing changes.
const outsideImage = browserTestImageProblem(process.env) !== undefined;

/**
 * End-to-end tests against the built examples: the codec capability matrix
 * of docs/adr/0001, no request to another origin (ADR 0012 in sdk-core),
 * the self-hosted worker under a strict Content Security Policy
 * (docs/adr/0002), the editor and the element by keyboard alone
 * (docs/adr/0005), and server rendering in Next.js (sdk-core ADR 0007). Chromium locally, all three engines in CI, as for
 * the other browser tests.
 */
export default defineConfig({
  testDir: "tests",
  forbidOnly: ci,
  retries: 0,
  reporter: ci ? "line" : "list",
  // Refuses to start outside the pinned image (#73, sdk-core ADR 0049).
  globalSetup: "@hussmartinez/sdk-config/testing/require-image",
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
  // Started with Node directly, so the suite also runs in the pinned browser
  // image, which has no pnpm (tools/update-capabilities.sh).
  webServer: outsideImage
    ? []
    : [
        {
          command: "node node_modules/vite/bin/vite.js preview --port 4310 --strictPort",
          cwd: "../examples/vite",
          url: "http://localhost:4310",
          reuseExistingServer: !ci,
          timeout: 60_000,
        },
        {
          command: "node node_modules/next/dist/bin/next start --port 4311",
          cwd: "../examples/next",
          env: { NEXT_TELEMETRY_DISABLED: "1" },
          url: "http://localhost:4311",
          reuseExistingServer: !ci,
          timeout: 60_000,
        },
      ],
});
