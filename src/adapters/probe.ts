import { AudioError } from "../core/errors/audio-error.js";
import type { AudioProbe } from "../core/model/source.js";
import { WindowReader } from "./bytes/window-reader.js";
import { skipId3v2 } from "./flac/flac.js";
import { probeNativeFlac } from "./flac/native-flac.js";
import { isOggFlac, probeOggFlac } from "./flac/ogg-flac.js";
import type { PcmLayout } from "./pcm/layout.js";
import { probePcm } from "./pcm/probe.js";

function unsupported(container: string, codec?: string): AudioError {
  return new AudioError("UNSUPPORTED_FORMAT", "This container or codec isn't supported.", {
    details: codec === undefined ? { container } : { container, codec },
  });
}

/**
 * Probes any file: recognises its container from its first bytes, and
 * hands it to that container's reader (docs/adr/0001). What isn't
 * recognised fails closed with `UNSUPPORTED_FORMAT`, so it's never handed to
 * a decoder. Uncompressed files also get the layout their parser needs.
 *
 * @internal
 */
export async function probeFile(
  file: Blob,
): Promise<{ readonly probe: AudioProbe; readonly layout?: PcmLayout }> {
  const reader = new WindowReader(file);
  const head = await reader.bytes(0, 64);
  const text = (start: number, end: number) => String.fromCharCode(...head.subarray(start, end));
  const magic = text(0, 4);
  const form = text(8, 12);

  if (
    ((magic === "RIFF" || magic === "RF64") && form === "WAVE") ||
    (magic === "FORM" && (form === "AIFF" || form === "AIFC"))
  ) {
    return probePcm(file);
  }
  if (magic === "fLaC") return { probe: await probeNativeFlac(file) };
  const afterId3 = skipId3v2(head);
  if (afterId3 > 0) {
    const marker = await reader.bytes(afterId3, 4);
    if (String.fromCharCode(...marker) === "fLaC") return { probe: await probeNativeFlac(file) };
    throw unsupported("unknown");
  }
  if (magic === "OggS") {
    // The first packet starts after the first page's segment table.
    const segments = head[26] ?? 0;
    const first = await reader.bytes(27 + segments, 8);
    if (isOggFlac(first)) return { probe: await probeOggFlac(file) };
    throw unsupported("ogg");
  }
  throw unsupported("unknown");
}
