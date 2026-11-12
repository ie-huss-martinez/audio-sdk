// Module types for the few non-standard imports the library makes. Declared
// here rather than through vite/client, so the library doesn't see Vite's
// or Node's global types.

/** The package version, defined at build time; the worker reports it so the page can check it. */
declare const __AUDIO_SDK_VERSION__: string;

/** A worker that Vite inlines into the build as a blob (docs/adr/0002). */
declare module "*?worker&inline" {
  const InlineWorker: new (options?: { readonly name?: string }) => Worker;
  export default InlineWorker;
}
