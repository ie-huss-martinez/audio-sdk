/**
 * `assetsUrl` as an absolute URL ending in a slash. `assetsUrl` is where the
 * application serves the package's `dist/assets/` directory, which holds
 * `audio/audio.worker.js` (docs/adr/0002). Relative URLs resolve against the
 * page.
 */
export function assetsBase(assetsUrl: string | URL | undefined): string | undefined {
  if (assetsUrl === undefined) return undefined;
  const base = new URL(String(assetsUrl), globalThis.location?.href).href;
  return base.endsWith("/") ? base : `${base}/`;
}
