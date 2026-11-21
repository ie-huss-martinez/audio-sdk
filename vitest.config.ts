import { browserInstances } from "@hussmartinez/sdk-config/testing/browser-instances";
import { browserTimeouts, unitTimeouts } from "@hussmartinez/sdk-config/testing/timeouts";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { testAssets, versionDefine } from "./tools/self-hosted-worker.js";

const ALL_BROWSERS = ["chromium", "firefox", "webkit"] as const;

// Browser tests run on Chromium locally, and on all three engines in CI or
// with --mode all-browsers (ADR 0015).
export default defineConfig(({ mode }) => {
  const browsers =
    process.env["CI"] || mode === "all-browsers" ? ALL_BROWSERS : (["chromium"] as const);
  return {
    test: {
      projects: [
        {
          define: versionDefine(),
          test: {
            name: "unit",
            // The family's limits, for a test and a hook (sdk-core ADR 0057).
            ...unitTimeouts,
            // build.test.ts checks the built package, so it sits next to the
            // Vite config rather than in src/. test/ holds the repository's
            // own checks, such as the CI image.
            include: ["src/**/*.test.{ts,tsx}", "*.test.ts", "test/**/*.test.{ts,tsx}"],
            exclude: ["**/*.browser.test.{ts,tsx}"],
            environment: "node",
          },
        },
        {
          define: versionDefine(),
          // Serves the self-hosted worker as the build writes it (docs/adr/0002).
          plugins: [testAssets()],
          // Bundled before the run: discovered mid-run, Vite reloads the page,
          // and a test file can fail to load.
          optimizeDeps: {
            include: [
              "@hussmartinez/sdk-config/testing/audio-output",
              "@hussmartinez/sdk-core",
              "@hussmartinez/sdk-core/element",
              "@hussmartinez/ui",
              "@hussmartinez/ui/react",
              "axe-core",
              "react",
              "react-dom/client",
            ],
          },
          test: {
            name: "browser",
            ...browserTimeouts,
            include: ["src/**/*.browser.test.{ts,tsx}", "test/**/*.browser.test.{ts,tsx}"],
            // Firefox crashes when two worlds read ariaLabelledByElements (#76).
            setupFiles: ["./test/firefox-labelled-by-guard.ts"],
            // Refuses to start outside the pinned image, where Docker's
            // network changes make Chromium fail at random (#73, sdk-core
            // ADR 0049).
            globalSetup: ["@hussmartinez/sdk-config/testing/require-image"],
            browser: {
              enabled: true,
              headless: true,
              provider: playwright(),
              // With HM_BROWSER_DIAGNOSTICS set to a folder, Chromium writes a
              // net log there, for failures that leave no message (sdk-config).
              instances: browserInstances(browsers),
            },
          },
        },
      ],
    },
  };
});
