import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  BROWSERS,
  type Browser,
  FORMATS,
  IN_PINNED_IMAGE,
  RESULTS,
  TABLE,
} from "./capabilities.js";

interface Result {
  readonly browser: Browser;
  readonly version: string;
  readonly format: string;
  readonly cell: string;
}

/**
 * After the suite, with UPDATE_CAPABILITIES=1, rewrites docs/capabilities.md
 * from what every engine did. Without it, does nothing: the tests compare
 * against the committed table instead.
 */
export default function updateCapabilities(): void {
  if (!process.env["UPDATE_CAPABILITIES"]) return;
  if (!IN_PINNED_IMAGE) {
    throw new Error(
      "docs/capabilities.md describes the pinned browser image. Regenerate it with tools/update-capabilities.sh.",
    );
  }
  mkdirSync(RESULTS, { recursive: true });
  const results: Result[] = readdirSync(RESULTS).map(
    (file) => JSON.parse(readFileSync(new URL(file, RESULTS), "utf8")) as Result,
  );
  const versions = Object.fromEntries(
    BROWSERS.map((browser) => [
      browser,
      results.find((r) => r.browser === browser)?.version ?? "?",
    ]),
  ) as Record<Browser, string>;
  const outcome = (format: string, browser: Browser) =>
    results.find((r) => r.format === format && r.browser === browser)?.cell ?? "not run";

  const rows = FORMATS.map(
    ({ name }) => `| ${name} | ${BROWSERS.map((browser) => outcome(name, browser)).join(" | ")} |`,
  );
  writeFileSync(
    TABLE,
    `# Codec capabilities

Which of the formats audio-sdk reads each browser engine decodes, measured by the end-to-end suite (\`e2e/tests/capabilities.spec.ts\`) on generated files, through the real engine. WAV and AIFF decode in the SDK's own worker, so they open everywhere; every other format decodes with the browser's own decoder ([ADR 0001](adr/0001-audio-engines.md)), so support varies.

- **decodes:** the file opened, and decoded within the probe's bound.
- **doesn't decode:** the SDK reads the format, but this browser's decoder refused it (\`DECODE_FAILED\`), or never finished and was stopped by the time limit (\`TIMEOUT\`), as WebKit does with FLAC from one run to the next. Either way the engine settles, and the page carries on.

The engines are those of the pinned browser image in \`ci/Dockerfile\`, where CI runs: Chromium ${versions.chromium}, Firefox ${versions.firefox} and WebKit ${versions.webkit}, on Linux. Results depend on how a browser was built: Playwright's WebKit on a plain Linux host has no AAC, for example, and **Playwright's WebKit isn't Safari**, which ships its own codecs. The suite compares outcomes with this table only in that image.

Vorbis and ALAC aren't in the table: they need real encoders to generate decodable files, and the SDK's tests exercise them through the probe only.

In the pinned image, the suite fails when a browser's outcome differs from this table. After the image or Playwright changes, regenerate it with \`pnpm build && pnpm build:examples && tools/update-capabilities.sh\`, which runs the suite in that image with Docker, and review the difference.

| Format | Chromium | Firefox | WebKit |
|---|---|---|---|
${rows.join("\n")}
`,
  );
}
