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

import { entryBudget, importBudget } from "@hussmartinez/sdk-config/size";

/**
 * An import budget, bundled as a host's bundler would: without this
 * repository's tsconfig, whose paths point the package's own import of its
 * inlined worker, #hm-audio-inline-worker, at the source for TypeScript. A
 * host resolves it through package.json's imports, to the lazy chunk the
 * budget leaves out (sdk-core ADR 0060).
 */
const forHosts = (budget) =>
  importBudget({
    ...budget,
    modifyEsbuildConfig: (config) => ({ ...config, tsconfigRaw: "{}" }),
  });

/**
 * An application's import from the core entry, as sdk-config's
 * `importBudget` measures it (sdk-core ADR 0056): without React, the
 * family's packages, which have budgets of their own, and the lazy worker.
 */
const coreImport = (name, imports, limit) =>
  forHosts({ name, entry: "dist/index.js", imports, limit });

/** An application's import from the React entry, measured the same way. */
const reactImport = (name, imports, limit) =>
  forHosts({ name, entry: "dist/react.js", imports, limit });

export default [
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
  entryBudget({
    name: "Server-safe core (.), with the shared code it loads",
    entry: "dist/index.js",
    limit: "24 kB",
  }),
  // Measured at 38.64 kB with the element beside it (docs/adr/0006, step
  // 16), 30.08 kB minified: the element shares its code, so it loads one
  // chunk more. It was 38.29 kB, 29.87 kB minified, with the export dialog
  // (step 15), and 35.63 kB, 27.76 kB minified, before that:
  // the provider, hooks, stage, notices, transport, toolbar, track
  // headers, rename dialog, the timeline and its waveforms, the clip,
  // range and fade tools, the inspector, the export dialog with the WAV
  // layout it sizes files by (not the writer), and the core's shared chunk
  // they use. It was 35.63 kB with range edits, 34.69 kB with the
  // inspector, 32.95 kB with range selection, 30.91 kB with the clip tools,
  // 28.70 kB with the track tools, 25.22 kB with the timeline, and
  // 22.64 kB with the shell. React and ui are the host's, so not counted.
  entryBudget({
    name: "React entry (./react), with the shared code it loads",
    entry: "dist/react.js",
    limit: "40 kB",
  }),
  // The element and the React editor it mounts (docs/adr/0006, step 16):
  // measured at 39.53 kB, 30.71 kB minified. The limit is the next 0.5 kB.
  // Empty before the element, it was 1 kB.
  entryBudget({
    name: "Element entry (./element), with the shared code it loads",
    entry: "dist/element.js",
    limit: "40 kB",
  }),
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
    // call (docs/adr/0002): the readers of every format, the peaks, the
    // mix and the WAV writer. Measured 15.05 kB with the export dialog
    // (docs/adr/0006, step 15), 14.85 kB minified, whose file sizes share
    // the writer's layout of a WAV file: that moved the layout into its own
    // module, which the worker now calls rather than inlining. It was
    // 14.90 kB, 14.72 kB minified. The limit is the next 0.5 kB.
    name: "Audio worker, inlined (lazy)",
    path: "dist/lazy/inline-worker.js",
    brotli: true,
    limit: "15.5 kB",
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
  // The React entry's floor, measured 3.51 kB: the editor's catalogue
  // alone, the SDK's messages and the editor's text, ui's being the host's,
  // with the error class and the limits' definitions the core's text keeps.
  // sdk-config 0.11.5 bundles import budgets as an ES module, as an
  // application's build does, which measures it 0.62 kB more than the
  // 2.89 kB of before, with no change of code: main's build measures
  // 3.52 kB the same way. A floor's limit is its measurement rounded up to
  // the next 0.1 kB. Before the entry came apart (sdk-core ADR 0056) it kept
  // nearly the whole editor: 16.64 kB, 16.98 kB by the ADR's own measure.
  reactImport("Import: audioEditorMessages (./react)", "{ audioEditorMessages }", "3.6 kB"),
];
