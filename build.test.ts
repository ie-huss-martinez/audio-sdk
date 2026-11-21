import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { build as esbuild } from "esbuild";
import { build, type Rolldown } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { externalPackages } from "./vite.config.js";

/**
 * Builds the package in memory with its real Vite config, so these checks see
 * exactly what dist/ would contain without writing to it.
 */
async function buildInMemory(): Promise<Array<Rolldown.OutputChunk | Rolldown.OutputAsset>> {
  const result = await build({
    configFile: new URL("vite.config.ts", import.meta.url).pathname,
    logLevel: "silent",
    build: { write: false },
  });
  const outputs = Array.isArray(result) ? result : [result];
  return outputs.flatMap((output) => ("output" in output ? output.output : []));
}

const files = await buildInMemory();

function chunk(fileName: string): Rolldown.OutputChunk {
  const found = files.find((file) => file.fileName === fileName);
  if (found?.type !== "chunk") {
    throw new Error(`${fileName} wasn't built as a JavaScript chunk`);
  }
  return found;
}

/**
 * An entry and every chunk it loads statically: what a page gets from
 * importing it. Code that several entries share is in a shared chunk.
 */
function loaded(entry: string): Rolldown.OutputChunk[] {
  const seen = new Map<string, Rolldown.OutputChunk>();
  const visit = (fileName: string) => {
    if (seen.has(fileName)) return;
    const found = chunk(fileName);
    seen.set(fileName, found);
    for (const name of found.imports)
      if (
        !name.startsWith("lazy/") &&
        name.endsWith(".js") &&
        files.some((file) => file.fileName === name)
      )
        visit(name);
  };
  visit(entry);
  return [...seen.values()];
}

describe("the built package", () => {
  it('starts the React entry with "use client" (ADR 0007)', () => {
    expect(chunk("react.js").code).toMatch(/^"use client";\n/);
  });

  it('keeps "use client" out of the core and element entries (ADR 0004)', () => {
    expect(chunk("index.js").code).not.toContain("use client");
    expect(chunk("element.js").code).not.toContain("use client");
  });

  it("emits the stylesheet as its own file", () => {
    const styles = files.find((file) => file.fileName === "styles.css");
    expect(styles?.type).toBe("asset");
  });

  it("imports sdk-core and React instead of bundling them", () => {
    expect(externalPackages).toEqual(
      expect.arrayContaining(["@hussmartinez/sdk-core", "react", "react-dom"]),
    );
    expect(
      loaded("index.js")
        .map((each) => each.code)
        .join("\n"),
    ).toContain('from "@hussmartinez/sdk-core"');
    for (const file of files) {
      if (file.type === "chunk") {
        // Bundled React or sdk-core would bring their own copies of these, and
        // a page with several SDKs would load sdk-core more than once.
        expect(file.code, file.fileName).not.toContain("react.transitional.element");
        expect(file.code, file.fileName).not.toContain("class SdkError");
      }
    }
  });

  it("uses the production JSX runtime and leaks no local paths", () => {
    const code = files.flatMap((file) => (file.type === "chunk" ? [file.code] : [])).join("\n");
    expect(code).not.toContain("jsx-dev-runtime");
    expect(code).not.toContain(process.cwd());
  });

  it("never imports CSS from JavaScript (ADR 0004)", () => {
    const javascript = files.filter((file) => file.type === "chunk");
    expect(javascript.length).toBeGreaterThan(0);
    for (const file of javascript) {
      expect(file.imports.filter((name) => name.endsWith(".css"))).toEqual([]);
      expect(file.code).not.toMatch(/import\s*["'][^"']+\.css["']/);
    }
  });
});

/**
 * Builds the package to a temporary folder inside the repository, so the
 * built files resolve their external imports from its node_modules, as they
 * would in an application.
 */
const temporaryBuild = (async () => {
  const parent = join(process.cwd(), "temp");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "build-test-"));
  await build({
    configFile: new URL("vite.config.ts", import.meta.url).pathname,
    logLevel: "silent",
    build: { outDir: directory, emptyOutDir: true },
  });
  return directory;
})();

afterAll(async () => {
  await rm(await temporaryBuild, { recursive: true, force: true });
});

describe("importing on a server", () => {
  // The unit project runs in Node, without a DOM, as a server would.
  it.each(["index.js", "element.js"])(
    "imports %s without touching browser APIs (ADR 0004, ADR 0007)",
    async (entry) => {
      expect(globalThis).not.toHaveProperty("window");
      expect(globalThis).not.toHaveProperty("customElements");
      const url = pathToFileURL(join(await temporaryBuild, entry)).href;
      await expect(import(url)).resolves.toBeTypeOf("object");
    },
  );
});

/**
 * Code generation from strings: `eval(…)`, `new Function(…)` and
 * `Function(…)`, as whole words, so `evaluate(` doesn't match (ADR 0028).
 */
const CODE_GENERATION = /(?<![\w$.])eval\s*\(|(?<![\w$.])(?:new\s+)?Function\s*\(/;

describe("the audio worker (docs/adr/0002)", () => {
  const worker = () => {
    const found = files.find((file) => file.fileName === "lazy/inline-worker.js");
    if (found?.type !== "chunk") throw new Error("the inlined worker chunk wasn't built");
    return found;
  };

  it("recognises code generation, and nothing that merely looks like it", () => {
    for (const code of ['eval("1")', 'new Function("a", "return a")', "x = Function ('y')"]) {
      expect(code).toMatch(CODE_GENERATION);
    }
    for (const code of ["evaluate(x)", "a.eval(x)", "isFunction(x)"]) {
      expect(code).not.toMatch(CODE_GENERATION);
    }
  });

  it("is inlined in a lazy chunk that only import() loads, never the entries", () => {
    expect(worker().code).toContain("hm-audio");
    for (const entry of ["index.js", "react.js", "element.js"]) {
      expect(
        chunk(entry).imports.filter((name) => name.startsWith("lazy/")),
        entry,
      ).toEqual([]);
    }
    // The core's code may sit in a chunk it shares with the React entry. It
    // loads the worker through package.json's imports, which the host's
    // bundler resolves (sdk-core ADR 0060).
    expect(loaded("index.js").flatMap((each) => each.dynamicImports)).toEqual([
      "#hm-audio-inline-worker",
    ]);
  });

  it("generates no code from strings, in any chunk, including the inlined worker", () => {
    for (const file of files) {
      if (file.type === "chunk") expect(file.code, file.fileName).not.toMatch(CODE_GENERATION);
    }
  });

  it("makes no requests of its own", () => {
    // The worker's only inputs are the Blobs the page sends it.
    expect(worker().code).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|importScripts|WebSocket/);
  });

  it("ships no worker source maps", () => {
    expect(files.filter((file) => /\.worker-[\w-]+\.js\.map$/.test(file.fileName))).toEqual([]);
    expect(worker().code).not.toMatch(/sourceMappingURL=data:/);
  });
});

/**
 * Writes this build into `dir` as an installed package would hold it: its
 * JavaScript under dist/, and a package.json with its exports and imports,
 * so `#hm-audio-inline-worker` resolves as it does for a host.
 */
async function writePackage(dir: string): Promise<void> {
  for (const file of files) {
    if (file.type !== "chunk") continue;
    await mkdir(dirname(join(dir, "dist", file.fileName)), { recursive: true });
    await writeFile(join(dir, "dist", file.fileName), file.code);
  }
  const manifest = JSON.parse(await readFile(new URL("package.json", import.meta.url), "utf8"));
  const { name, type, exports, imports } = manifest;
  await writeFile(join(dir, "package.json"), JSON.stringify({ name, type, exports, imports }));
}

describe("the hm-self-hosted condition (sdk-core ADR 0060)", () => {
  /**
   * Bundles an application that passes assetsUrl against this build, laid
   * out as an installed package, with esbuild and `conditions`. Returns the
   * code of every output file.
   */
  async function bundle(conditions: string[]): Promise<string[]> {
    const dir = await mkdtemp(join(tmpdir(), "hm-audio-sdk-condition-"));
    try {
      await writePackage(join(dir, "node_modules/@hussmartinez/audio-sdk"));
      await writeFile(
        join(dir, "app.js"),
        [
          'import { createAudioAdapters } from "@hussmartinez/audio-sdk";',
          'export const adapters = createAudioAdapters({ assetsUrl: "/audio-sdk/" });',
        ].join("\n"),
      );
      const result = await esbuild({
        absWorkingDir: dir,
        entryPoints: ["app.js"],
        bundle: true,
        format: "esm",
        splitting: true,
        outdir: "out",
        write: false,
        logLevel: "silent",
        conditions,
        external: externalPackages,
      });
      return result.outputFiles.map((output) => output.text);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** The inlined worker: Vite turns it into a blob that revokes its own URL. */
  const inlinedWorker = (code: string) => code.includes("URL.revokeObjectURL(import.meta.url);");

  it("leaves the inlined worker out of a build that sets it", async () => {
    const outputs = await bundle(["hm-self-hosted"]);
    expect(outputs.filter(inlinedWorker)).toEqual([]);
    expect(outputs.join("\n")).toContain("left the audio SDK's inlined worker out");
  });

  it("keeps it in a build that doesn't, as before", async () => {
    const outputs = await bundle([]);
    expect(outputs.filter(inlinedWorker)).toHaveLength(1);
    expect(outputs.join("\n")).not.toContain("left the audio SDK's inlined worker out");
  });
});

describe("the self-hosted worker (docs/adr/0002)", () => {
  const selfHosted = () => {
    const found = files.find((file) => file.fileName === "assets/audio/audio.worker.js");
    if (found?.type !== "asset") throw new Error("dist/assets/audio/audio.worker.js wasn't built");
    return String(found.source);
  };

  it("is written to dist/assets/audio/audio.worker.js, as one module with no imports", () => {
    const code = selfHosted();
    expect(code).not.toMatch(/^\s*import\s|\bimport\s*\(/m);
    expect(code).toContain("hm-rpc");
  });

  it("announces this package's version, which the engine checks", async () => {
    const { version } = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
    // In any quotes: the minifier may write it as a template literal.
    const escaped = version.replaceAll(".", "\\.");
    expect(selfHosted()).toMatch(new RegExp(`packageVersion:[\`"']${escaped}[\`"']`));
  });

  it("generates no code from strings, and makes no requests", () => {
    const code = selfHosted();
    expect(code).not.toMatch(CODE_GENERATION);
    expect(code).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|importScripts|WebSocket/);
  });
});
