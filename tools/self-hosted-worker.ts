import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build, type Plugin, type Rolldown } from "vite";

/** The package's version, which the worker reports and the page checks (docs/adr/0002). */
export const PACKAGE_VERSION = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

/** The `define` that puts the version into the page's code and the worker's. */
export function versionDefine(version = PACKAGE_VERSION): Record<string, string> {
  return { __AUDIO_SDK_VERSION__: JSON.stringify(version) };
}

const ENTRY = fileURLToPath(new URL("../src/workers/audio.worker.ts", import.meta.url));

/**
 * Builds the self-hosted audio worker: one minified ES module with no
 * imports, the same code as the inlined worker (docs/adr/0002).
 */
export async function buildSelfHostedWorker(version = PACKAGE_VERSION): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    define: { ...versionDefine(version), "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      write: false,
      minify: true,
      target: "es2022",
      sourcemap: false,
      lib: { entry: ENTRY, formats: ["es"], fileName: () => "audio.worker.js" },
      rolldownOptions: { output: { codeSplitting: false, minify: true } },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const chunk = outputs.flatMap((output) => output.output).find((file) => file.type === "chunk");
  if (chunk?.type !== "chunk") throw new Error("The self-hosted audio worker didn't build.");
  return chunk.code;
}

/** Writes the self-hosted worker to `dist/assets/audio/audio.worker.js`. */
export function selfHostedWorker(): Plugin {
  return {
    name: "hm-self-hosted-audio-worker",
    async generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "assets/audio/audio.worker.js",
        source: await buildSelfHostedWorker(),
      });
    },
  };
}

/**
 * For the browser tests only: serves exactly what the build writes to
 * `dist/assets/`, so self-hosted mode is tested with the real worker file.
 *
 * - `/hm-test-assets/`: the worker as built.
 * - `/hm-test-assets-stale/`: a worker built as another version, as a host
 *   that forgot to copy `dist/assets` after upgrading would serve.
 */
export function testAssets(): Plugin {
  const workers = new Map<string, Promise<string>>();
  return {
    name: "hm-test-assets",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const match = /^\/hm-test-assets(-stale)?\/audio\/audio\.worker\.js(?:\?|$)/.exec(
          request.url ?? "",
        );
        if (!match) return next();
        const version = match[1] ? "0.0.0-stale" : PACKAGE_VERSION;
        try {
          if (!workers.has(version)) workers.set(version, buildSelfHostedWorker(version));
          response.setHeader("Content-Type", "text/javascript");
          response.end(await workers.get(version));
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
