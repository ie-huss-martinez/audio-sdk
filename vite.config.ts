import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { selfHostedWorker, versionDefine } from "./tools/self-hosted-worker.js";

const manifest = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

/**
 * Dependencies and peer dependencies stay imports, never bundled: a page with
 * several SDKs then loads one copy of each, and React stays a single copy.
 * Subpaths such as react/jsx-runtime count too.
 */
export const externalPackages = [
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
];
const isExternal = (id: string): boolean =>
  externalPackages.some((name) => id === name || id.startsWith(`${name}/`));

/** One built file per public entry point (ADR 0004). */
export const entries = {
  index: "src/index.ts",
  react: "src/react.ts",
  element: "src/element.ts",
  styles: "src/styles.css",
} as const;

const entryFiles = new Set(
  Object.values(entries).map((entry) => fileURLToPath(new URL(entry, import.meta.url))),
);

/**
 * Vite writes each worker's source map next to the build even when the worker
 * is inlined. The maps aren't referenced, so they're dropped.
 */
const dropWorkerSourceMaps: Plugin = {
  name: "hm-drop-worker-source-maps",
  generateBundle(_options, bundle) {
    for (const fileName of Object.keys(bundle)) {
      if (/\.worker-[\w-]+\.js\.map$/.test(fileName)) {
        delete bundle[fileName];
      }
    }
  },
};

// Library build: unminified ES modules with source maps, so that consumers'
// bundlers can tree-shake and minify them, and one stylesheet that bundles
// every CSS file it imports. No JavaScript imports CSS.
export default defineConfig({
  // The production JSX runtime, whatever NODE_ENV the build runs with.
  // Otherwise a build under NODE_ENV=development or test ships jsxDEV and
  // the absolute path of every source file.
  oxc: {
    jsx: { runtime: "automatic", development: false },
  },
  plugins: [dropWorkerSourceMaps, selfHostedWorker()],
  // The package version, which the worker reports and the page checks.
  define: versionDefine(),
  // Workers are ES modules, built into one file each, and inlined as blobs
  // where they're imported with ?worker&inline (docs/adr/0002).
  worker: {
    format: "es",
    // Minified, unlike the library: an inlined worker is a string that
    // applications' bundlers can't minify.
    rolldownOptions: { output: { codeSplitting: false, minify: true } },
    plugins: () => [
      {
        name: "hm-no-worker-source-maps",
        generateBundle(_options, bundle) {
          for (const file of Object.values(bundle)) {
            if (file.type === "chunk") {
              file.map = null;
              file.code = file.code.replace(/\n\/\/# sourceMappingURL=\S+\s*$/, "\n");
            }
          }
        },
      },
    ],
  },
  build: {
    lib: {
      entry: entries,
      formats: ["es"],
    },
    // Required for a CSS file as an entry; it's then emitted as its own file.
    cssCodeSplit: true,
    target: "es2022",
    minify: false,
    sourcemap: true,
    rolldownOptions: {
      external: isExternal,
      output: {
        // Code shared by several entries goes in shared/, so the size budgets
        // count it with each entry that loads it. Code loaded with import(),
        // such as the inlined audio worker, goes in lazy/, with budgets of
        // its own.
        chunkFileNames: (chunk) =>
          chunk.isDynamicEntry ? "lazy/[name]-[hash].js" : "shared/[name]-[hash].js",
        // TSDoc reaches users through the .d.ts files and the source maps, so
        // the JavaScript keeps only legal and @__PURE__ annotation comments.
        comments: { legal: true, annotation: true, jsdoc: false },
      },
      onLog(level, log, handler) {
        // Rolldown always keeps a top-level directive in an entry module, which
        // is how "use client" stays at the top of dist/react.js (ADR 0007).
        // Its warning only matters for directives in other modules, so it's
        // kept for those. build.test.ts checks the built entries.
        if (log.code === "MODULE_LEVEL_DIRECTIVE" && log.id && entryFiles.has(log.id)) {
          return;
        }
        handler(level, log);
      },
    },
  },
});
