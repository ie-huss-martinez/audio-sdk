import preset from "@hussmartinez/sdk-config/dependency-cruiser";

/**
 * A package's stylesheet as a URL, through Vite's `?url` suffix, such as the
 * browser tests' `@hussmartinez/ui/styles.css?url`: dependency-cruiser can't
 * resolve a query through a package's exports, but Vite does, and fails the
 * test run if the file is missing. Only stylesheets, and only as URLs. The
 * same exception as pdf-sdk's, for the same shared test helper.
 */
const STYLESHEET_URLS = "^@hussmartinez/[a-z-]+/styles\\.css\\?url$";

const forbidden = preset.forbidden.map((rule) =>
  rule.name === "not-to-unresolvable"
    ? {
        ...rule,
        to: { ...rule.to, pathNot: [rule.to.pathNot, STYLESHEET_URLS].flat().filter(Boolean) },
      }
    : rule,
);

export default { ...preset, forbidden };
