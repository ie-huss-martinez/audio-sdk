/**
 * Size budgets (ADR 0015), of two kinds.
 *
 * - **Entry ceilings,** the first entries: the brotli size of each built
 *   entry, with the shared chunks it loads, measured as files in dist
 *   (with the esbuild plugin disabled). They're an upper bound on what any application can
 *   ship from an entry. A ceiling is raised in the pull request that needs
 *   it, to the next whole kB, with the measured number.
 * - **Import budgets,** after them: what an application ships when it
 *   imports one factory, bundled and minified by esbuild, as its bundler
 *   would, so each one guards the code that factory pulls in. They leave
 *   out sdk-core, which its own budgets cover and every SDK shares, and the
 *   worker, which loads lazily on the first call and has its own budget.
 *   Each is set a little above its measured size, so growth is noticed.
 */

/** An application's import from the core entry, without sdk-core and the lazy worker. */
const coreImport = (name, imports, limit) => ({
  name,
  path: "dist/index.js",
  import: imports,
  ignore: ["@hussmartinez/sdk-core", "./lazy/*"],
  brotli: true,
  limit,
});

export default [
  {
    disablePlugins: ["@size-limit/esbuild"],
    // Measured at 15.06 kB with resampling on insert (docs/adr/0006): the
    // session, the engine's and the processor's page sides, playback, the
    // plan's reader and the text of errors and warnings. Minified, as an
    // application ships it, it's 11.53 kB.
    name: "Server-safe core (.), with the shared code it loads",
    path: ["dist/index.js", "dist/shared/*.js"],
    brotli: true,
    limit: "16 kB",
  },
  {
    disablePlugins: ["@size-limit/esbuild"],
    name: "React entry (./react), with the shared code it loads",
    path: ["dist/react.js", "dist/shared/*.js"],
    brotli: true,
    limit: "40 kB",
  },
  {
    disablePlugins: ["@size-limit/esbuild"],
    name: "Element entry (./element), with the shared code it loads",
    path: ["dist/element.js", "dist/shared/*.js"],
    brotli: true,
    limit: "40 kB",
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
  // Measured 6.42 kB: the session, its reducer, history and limits.
  coreImport("Import: createAudioSession", "{ createAudioSession }", "7.5 kB"),
  // Measured 3.55 kB: the engine's page side, decoding on the page, peaks,
  // and sending blocks to the worker's resampler.
  coreImport("Import: createAudioEngine", "{ createAudioEngine }", "3.6 kB"),
  // Measured 2.52 kB: the processor's page side, gathering blocks for export.
  coreImport("Import: createAudioProcessor", "{ createAudioProcessor }", "3 kB"),
  // Measured 2.52 kB: playback, its graph and its gain automation.
  coreImport("Import: createAudioOutput", "{ createAudioOutput }", "3 kB"),
  // Measured 0.88 kB: the English catalogue.
  coreImport("Import: audioMessages", "{ audioMessages }", "1.1 kB"),
  // Measured 2.61 kB: reading and writing hm-audio-plan documents.
  coreImport("Import: plan documents", "{ readAudioPlanDocument, toAudioPlanDocument }", "3 kB"),
  // Measured 10.49 kB: what an editor imports, shared code counted once.
  coreImport(
    "Import: an editor's set",
    "{ createAudioSession, createAudioEngine, createAudioProcessor, createAudioOutput, audioMessages }",
    "12 kB",
  ),
];
