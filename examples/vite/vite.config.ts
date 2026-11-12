import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * Serves the package's `dist/assets/` under `/audio-sdk/`, as a host
 * self-hosting the worker would (docs/adr/0002 in the package).
 */
function audioSdkAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve("@hussmartinez/audio-sdk/package.json"));
  const worker = "audio/audio.worker.js";
  return {
    name: "copy-audio-sdk-assets",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: `audio-sdk/${worker}`,
        source: readFileSync(join(root, "dist/assets", worker)),
      });
    },
  };
}

export default defineConfig({
  plugins: [audioSdkAssets()],
  build: {
    target: "es2022",
    rollupOptions: { input: { index: "index.html", strict: "strict.html" } },
  },
});
