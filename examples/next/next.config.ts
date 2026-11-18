import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const root = fileURLToPath(new URL("../..", import.meta.url));

const config: NextConfig = {
  // The workspace root, so Next.js doesn't guess it from lockfiles.
  turbopack: { root },
  outputFileTracingRoot: root,
  poweredByHeader: false,
};

export default config;
