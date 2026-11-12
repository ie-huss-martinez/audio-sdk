import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { BROWSERS, type Browser, FORMATS, RESULTS, TABLE } from "./capabilities.js";

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

The engines are Playwright's builds, on Linux: Chromium ${versions.chromium}, Firefox ${versions.firefox} and WebKit ${versions.webkit}. **Playwright's WebKit isn't Safari:** it lacks the proprietary codecs Safari ships, such as AAC and FLAC, so Safari opens more than its column shows.

Vorbis and ALAC aren't in the table: they need real encoders to generate decodable files, and the SDK's tests exercise them through the probe only.

The suite fails when a browser's outcome differs from this table. After a browser update, regenerate it from all three engines with \`pnpm build && pnpm build:examples && UPDATE_CAPABILITIES=1 pnpm test:e2e\`, and review the difference.

| Format | Chromium | Firefox | WebKit |
|---|---|---|---|
${rows.join("\n")}
`,
  );
}
