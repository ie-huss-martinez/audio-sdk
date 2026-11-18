/**
 * Size budgets (ADR 0015), of two kinds.
 *
 * - **Entry ceilings,** the first entries: the brotli size of each built
 *   entry, with the shared chunks it loads and only those, measured as files
 *   in dist (with the esbuild plugin disabled). They're an upper bound on what any application can
 *   ship from an entry. A ceiling is raised in the pull request that needs
 *   it, to the next whole kB, with the measured number.
 * - **Import budgets,** after them: what an application ships when it
 *   imports one factory, bundled and minified by esbuild, as its bundler
 *   would, so each one guards the code that factory pulls in. They leave
 *   out sdk-core, which its own budgets cover and every SDK shares, and the
 *   worker, which loads lazily on the first call and has its own budget.
 *   Each is set a little above its measured size, so growth is noticed.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

/**
 * The built files an entry loads up front: the entry, and every chunk it
 * imports statically, directly or through other chunks. Counting only these,
 * rather than every shared chunk, keeps one entry's budget from paying for
 * code that only another entry loads. Chunks loaded with `import()`, in
 * `lazy/`, have budgets of their own. video-sdk's, unchanged.
 */
function loadedFiles(file) {
  const seen = new Set();
  const visit = (path) => {
    if (seen.has(path) || !existsSync(path)) return;
    seen.add(path);
    const code = readFileSync(path, "utf8");
    for (const [, specifier] of code.matchAll(/(?:from\s*|import\s+)"(\.{1,2}\/[^"]+\.js)"/g)) {
      visit(normalize(join(dirname(path), specifier)));
    }
  };
  visit(join("dist", file));
  return [...seen];
}

/** An application's import from the core entry, without sdk-core and the lazy worker. */
const coreImport = (name, imports, limit) => ({
  name,
  path: "dist/index.js",
  import: imports,
  // The lazy worker is imported from the entry, or from a shared chunk when
  // another entry shares the code, as ../lazy/ from there.
  ignore: ["@hussmartinez/sdk-core", "./lazy/*", "../lazy/*"],
  brotli: true,
  limit,
});

export default [
  {
    disablePlugins: ["@size-limit/esbuild"],
    // Measured at 23.39 kB with the multitrack plan (docs/adr/0006): the
    // session, the reducer of tracks and time edits, the readers of both
    // format versions with the migration of version 1's plans and commands,
    // the mix's gathering, the engine's and the processor's page sides,
    // playback with its playhead watcher, the adapters made together, the
    // timecode and waveform columns, and the text of errors and warnings,
    // by code and reason. Minified, as an
    // application ships it, it's 17.78 kB. The React entry shares most of
    // this code, so the build splits it into the entry and a shared chunk,
    // which costs about 1.1 kB minified without a change of code: two
    // files compress apart, and carry their exports' names. Before the
    // React entry it was 21.81 kB, 16.67 kB minified. Before tracks it was 15.06 kB,
    // and 11.53 kB minified.
    name: "Server-safe core (.), with the shared code it loads",
    path: loadedFiles("index.js"),
    brotli: true,
    limit: "24 kB",
  },
  {
    disablePlugins: ["@size-limit/esbuild"],
    // Measured at 34.69 kB with the inspector (docs/adr/0006, step 14a):
    // the provider, hooks, stage, notices, transport, toolbar, track
    // headers, rename dialog, the timeline and its waveforms, the clip and
    // range tools, the inspector, and the core's shared chunk they use. It
    // was 32.95 kB with range selection, 30.91 kB with the clip tools,
    // 28.70 kB with the track tools, 25.22 kB with the timeline, and
    // 22.64 kB with the shell. React and ui are the host's, so not counted.
    name: "React entry (./react), with the shared code it loads",
    path: loadedFiles("react.js"),
    brotli: true,
    limit: "40 kB",
  },
  {
    disablePlugins: ["@size-limit/esbuild"],
    // Empty until the element arrives (docs/adr/0006, step 16), which sets
    // its budget from what it measures. Counted with every shared chunk, as
    // before this measured only what it loads, it read 19.13 kB.
    name: "Element entry (./element), with the shared code it loads",
    path: loadedFiles("element.js"),
    brotli: true,
    limit: "1 kB",
  },
  {
    disablePlugins: ["@size-limit/esbuild"],
    name: "Stylesheet (./styles.css)",
    path: "dist/styles.css",
    brotli: true,
    limit: "10 kB",
  },
  {
    disablePlugins: ["@size-limit/esbuild"],
    // The audio worker, inlined as a minified string and loaded on the first
    // call (docs/adr/0002): the WAV and AIFF readers and the peaks. It
    // measures about 5 kB; the compressed formats' readers will join it.
    name: "Audio worker, inlined (lazy)",
    path: "dist/lazy/inline-worker-*.js",
    brotli: true,
    limit: "15 kB",
  },
  {
    disablePlugins: ["@size-limit/esbuild"],
    // The same worker, self-hosted under assetsUrl (docs/adr/0002). It
    // measures about the same as the inlined one.
    name: "Audio worker, self-hosted",
    path: "dist/assets/audio/audio.worker.js",
    brotli: true,
    limit: "15 kB",
  },
  // Measured 9.66 kB: the session, the reducer of tracks, clip edits and
  // time edits, the keys it fills, the cleaning of file names it shares
  // with pdf-sdk, history and limits. It was 6.42 kB with one track.
  coreImport("Import: createAudioSession", "{ createAudioSession }", "10 kB"),
  // Measured 3.60 kB: the engine's page side, decoding on the page, peaks,
  // and sending blocks to the worker's resampler, with the limits'
  // definitions, which the track limit added to. It was 3.55 kB.
  coreImport("Import: createAudioEngine", "{ createAudioEngine }", "4 kB"),
  // Measured 2.68 kB: the processor's page side, gathering each block's
  // audible clips for the worker's mix.
  coreImport("Import: createAudioProcessor", "{ createAudioProcessor }", "3 kB"),
  // Measured 3.06 kB: playback, its graph of tracks, their levels changed
  // while playing, telling subscribers when the playhead jumps, and its gain
  // automation. It was 2.88 kB.
  coreImport("Import: createAudioOutput", "{ createAudioOutput }", "3.5 kB"),
  // Measured 6.56 kB: the engine's, the processor's and the output's page
  // sides together, with destroying them together (docs/adr/0006).
  coreImport("Import: createAudioAdapters", "{ createAudioAdapters }", "7 kB"),
  // Measured 0.88 kB: the English catalogue.
  coreImport("Import: audioMessages", "{ audioMessages }", "1.1 kB"),
  // Measured 3.40 kB: reading hm-audio-plan documents of versions 1 and 2,
  // migrating the first, and writing version 2. It was 2.61 kB.
  coreImport("Import: plan documents", "{ readAudioPlanDocument, toAudioPlanDocument }", "4 kB"),
  // Measured 14.50 kB: what an editor imports, shared code counted once.
  // It was 10.97 kB with one track, and 14.48 kB on sdk-core 0.4.1; 0.4.4
  // adds 21 B with no change in this package's core.
  coreImport(
    "Import: an editor's set",
    "{ createAudioSession, createAudioEngine, createAudioProcessor, createAudioOutput, audioMessages }",
    "15 kB",
  ),
];
