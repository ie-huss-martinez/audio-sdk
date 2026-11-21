import { fileURLToPath } from "node:url";
import { browserInstances } from "@hussmartinez/sdk-config/testing/browser-instances";
import { browserTimeouts, unitTimeouts } from "@hussmartinez/sdk-config/testing/timeouts";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { testAssets, versionDefine } from "./tools/self-hosted-worker.js";
import { selfHostedImports } from "./vite.config.js";

const ALL_BROWSERS = ["chromium", "firefox", "webkit"] as const;

/**
 * The tests run the source: package.json's imports name the built files
 * (sdk-core ADR 0060), so each one points at its module here.
 */
const selfHostedAliases = {
  alias: Object.entries(selfHostedImports).map(([find, path]) => ({
    find,
    replacement: fileURLToPath(new URL(path, import.meta.url)),
  })),
};

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
          resolve: selfHostedAliases,
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
          resolve: selfHostedAliases,
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
