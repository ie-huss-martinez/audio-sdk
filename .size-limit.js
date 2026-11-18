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
    // Measured at 19.81 kB with the multitrack plan (docs/adr/0006): the
    // session, the reducer of tracks and time edits, the readers of both
    // format versions with the migration of version 1's plans and commands,
    // the mix's gathering, the engine's and the processor's page sides,
    // playback and the text of errors and warnings. Minified, as an
    // application ships it, it's 15.24 kB. Before tracks it was 15.06 kB,
    // and 11.53 kB minified.
    name: "Server-safe core (.), with the shared code it loads",
    path: ["dist/index.js", "dist/shared/*.js"],
    brotli: true,
    limit: "20 kB",
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
  // Measured 8.96 kB: the session, the reducer of tracks, clip edits and
  // time edits, history and limits. It was 6.42 kB with one track.
  coreImport("Import: createAudioSession", "{ createAudioSession }", "9.5 kB"),
  // Measured 3.60 kB: the engine's page side, decoding on the page, peaks,
  // and sending blocks to the worker's resampler, with the limits'
  // definitions, which the track limit added to. It was 3.55 kB.
  coreImport("Import: createAudioEngine", "{ createAudioEngine }", "4 kB"),
  // Measured 2.68 kB: the processor's page side, gathering each block's
  // audible clips for the worker's mix.
  coreImport("Import: createAudioProcessor", "{ createAudioProcessor }", "3 kB"),
  // Measured 2.88 kB: playback, its graph of tracks, their levels changed
  // while playing, and its gain automation.
  coreImport("Import: createAudioOutput", "{ createAudioOutput }", "3 kB"),
  // Measured 0.88 kB: the English catalogue.
  coreImport("Import: audioMessages", "{ audioMessages }", "1.1 kB"),
  // Measured 3.40 kB: reading hm-audio-plan documents of versions 1 and 2,
  // migrating the first, and writing version 2. It was 2.61 kB.
  coreImport("Import: plan documents", "{ readAudioPlanDocument, toAudioPlanDocument }", "4 kB"),
  // Measured 13.37 kB: what an editor imports, shared code counted once.
  // It was 10.97 kB with one track.
  coreImport(
    "Import: an editor's set",
    "{ createAudioSession, createAudioEngine, createAudioProcessor, createAudioOutput, audioMessages }",
    "14.5 kB",
  ),
];
