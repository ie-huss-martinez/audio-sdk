import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

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
        // Code shared by several entries goes here, so the size budgets can
        // count it with each entry that loads it.
        chunkFileNames: "shared/[name]-[hash].js",
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
