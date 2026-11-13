import { createWindowReader } from "@hussmartinez/sdk-core";
import { AudioError } from "../core/errors/audio-error.js";
import type { AudioProbe } from "../core/model/source.js";
import { findAdts, probeAdts } from "./aac/adts.js";
import { skipId3v2 } from "./flac/flac.js";
import { probeNativeFlac } from "./flac/native-flac.js";
import { isOggFlac, probeOggFlac } from "./flac/ogg-flac.js";
import { probeMatroska } from "./matroska/matroska.js";
import { probeMp4 } from "./mp4/mp4.js";
import { findMp3, probeMp3 } from "./mpeg/mp3.js";
import { isOggOpus, probeOggOpus } from "./ogg/ogg-opus.js";
import { isOggVorbis, probeOggVorbis } from "./ogg/ogg-vorbis.js";
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
  const reader = createWindowReader(file);
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
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return { probe: await probeMatroska(file) };
  }
  // MP4 starts with a box, usually ftyp; QuickTime files may start with others.
  if (["ftyp", "moov", "mdat", "free", "skip", "wide"].includes(text(4, 8))) {
    return { probe: await probeMp4(file) };
  }
  const afterId3 = skipId3v2(head);
  if (afterId3 > 0) {
    const marker = await reader.bytes(afterId3, 4);
    if (String.fromCharCode(...marker) === "fLaC") return { probe: await probeNativeFlac(file) };
  }
  if (magic === "OggS") {
    // The first packet starts after the first page's segment table.
    const segments = head[26] ?? 0;
    const first = await reader.bytes(27 + segments, 8);
    if (isOggFlac(first)) return { probe: await probeOggFlac(file) };
    if (isOggOpus(first)) return { probe: await probeOggOpus(file) };
    if (isOggVorbis(first)) return { probe: await probeOggVorbis(file) };
    throw unsupported("ogg");
  }
  // MPEG audio and ADTS have no magic number: a run of consistent frame
  // headers at the start, or after an ID3v2 tag, identifies them.
  const [mp3, adts] = await Promise.all([findMp3(file, afterId3), findAdts(file, afterId3)]);
  if (mp3 && (!adts || mp3.offset <= adts.offset)) return { probe: await probeMp3(file, afterId3) };
  if (adts) return { probe: await probeAdts(file, afterId3) };
  throw unsupported("unknown");
}
