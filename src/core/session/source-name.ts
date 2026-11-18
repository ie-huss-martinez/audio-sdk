import { MAX_SOURCE_NAME_LENGTH as MAX_NAME_LENGTH } from "../model/source.js";

/*
 * pdf-sdk's `src/core/session/source-name.ts`, with the same rules, steps
 * and tests, which only its length constant's import differs from. The
 * family cleans a file name one way, as pdf-sdk ADR 0009 decides, because
 * the same name may become a download's in either editor (docs/adr/0006).
 * It moves to sdk-core once that has it.
 */

export { MAX_NAME_LENGTH };

/** Control characters (Unicode category Cc: C0, DEL and C1). */
const CONTROL = /\p{Cc}/gu;
/** Bidirectional formatting characters, which can disguise an extension. */
const BIDI = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;
/** Characters Windows refuses in file names. Separators are handled first. */
const REFUSED = /[<>:"|?*]/gu;

/**
 * Cleans a file name chosen by whoever made the file, which is hostile input
 * (pdf-sdk ADR 0009). The result is safe as text content and as a download's
 * name: one path segment, with no control or bidirectional formatting
 * characters, no characters Windows refuses, no leading dots and at most
 * {@link MAX_NAME_LENGTH} code points. Returns `undefined` when nothing is
 * left, or for anything that isn't a string.
 */
export function cleanFileName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  let name = raw.replace(CONTROL, "").replace(BIDI, "");
  name = name.slice(Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1);
  // Normalised after the removals, which could leave a base letter and its
  // combining mark side by side.
  name = name.replace(REFUSED, "").normalize("NFC");
  // Leading dots would hide the file on some systems, or leave only an
  // extension; whitespace at either end is never meant.
  name = name.replace(/^[\s.]+/u, "").trimEnd();
  // Array.from splits by code points, so no surrogate pair is cut in half.
  const points = Array.from(name);
  if (points.length > MAX_NAME_LENGTH) {
    name = points.slice(0, MAX_NAME_LENGTH).join("").trimEnd();
  }
  return name === "" ? undefined : name;
}
