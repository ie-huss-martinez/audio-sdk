import { readFileSync } from "node:fs";
import { flacFile, oggFlacFile } from "../test/fixtures/flac-files.js";
import { mp4File } from "../test/fixtures/mp4-files.js";
import { adtsFile, mp3File } from "../test/fixtures/mpeg-files.js";
import { oggOpusFile } from "../test/fixtures/ogg-files.js";
import { aiffFile, wavFile } from "../test/fixtures/pcm-files.js";
import { webmFile } from "../test/fixtures/webm-files.js";

export const BROWSERS = ["chromium", "firefox", "webkit"] as const;
export type Browser = (typeof BROWSERS)[number];

export const TABLE = new URL("../docs/capabilities.md", import.meta.url);
/** Where each test writes what it saw, for regenerating the table. */
export const RESULTS = new URL("./test-results/capabilities/", import.meta.url);

const TONE = Array.from({ length: 4_410 }, (_, i) => Math.sin(i / 7) * 0.5);

/**
 * One generated file per container and codec the SDK reads (docs/adr/0001).
 * Vorbis and ALAC aren't here: decodable files of those need real encoders,
 * and the fixtures the unit tests use exercise only the probe.
 */
export const FORMATS: readonly { name: string; bytes: () => Uint8Array }[] = [
  { name: "WAV, 16-bit PCM", bytes: () => wavFile([TONE, TONE], { sampleRate: 44_100 }) },
  {
    name: "WAV, 32-bit float",
    bytes: () => wavFile([TONE], { sampleRate: 48_000, format: "float32" }),
  },
  {
    name: "WAV (RF64), 24-bit PCM",
    bytes: () => wavFile([TONE], { sampleRate: 44_100, format: "pcm24", rf64: true }),
  },
  { name: "AIFF, 16-bit PCM", bytes: () => aiffFile([TONE, TONE], { sampleRate: 44_100 }) },
  {
    name: "AIFC, little-endian PCM (sowt)",
    bytes: () => aiffFile([TONE], { sampleRate: 44_100, type: "sowt" }),
  },
  {
    name: "AIFC, 32-bit float (fl32)",
    bytes: () => aiffFile([TONE], { sampleRate: 44_100, type: "fl32" }),
  },
  { name: "FLAC", bytes: () => flacFile([TONE, TONE], { sampleRate: 44_100, blockSize: 1_024 }) },
  {
    name: "FLAC in Ogg",
    bytes: () => oggFlacFile([TONE, TONE], { sampleRate: 44_100, blockSize: 1_024 }),
  },
  { name: "MP3, MPEG-1 Layer III, 44.1 kHz", bytes: () => mp3File({ frames: 40 }) },
  {
    name: "MP3, MPEG-2 Layer III, 22.05 kHz",
    bytes: () => mp3File({ frames: 40, version: 2, sampleRate: 22_050, bitrateIndex: 8 }),
  },
  {
    name: "MP3, MPEG-2.5 Layer III, 8 kHz",
    bytes: () => mp3File({ frames: 40, version: 2.5, sampleRate: 8_000, bitrateIndex: 8 }),
  },
  {
    name: "MP3 with an Info tag and LAME's delay",
    bytes: () => mp3File({ frames: 40, info: { frames: 40, delay: 576, padding: 300 } }),
  },
  { name: "AAC-LC in ADTS, 44.1 kHz", bytes: () => adtsFile(40, { sampleRate: 44_100 }) },
  { name: "AAC-LC in ADTS, 22.05 kHz", bytes: () => adtsFile(40, { sampleRate: 22_050 }) },
  { name: "AAC-LC in MP4 (M4A)", bytes: () => mp4File({ samples: 40 }) },
  { name: "Opus in Ogg", bytes: () => oggOpusFile({ packets: 50 }) },
  { name: "Opus in WebM", bytes: () => webmFile({ packets: 50, durationMs: 1_000 }) },
  {
    name: "Opus in WebM, as MediaRecorder writes it",
    bytes: () => webmFile({ packets: 50, unknownSizes: true }),
  },
];

/** The outcomes in docs/capabilities.md, by format and browser. */
export function readTable(): Map<string, Partial<Record<Browser, string>>> {
  const table = new Map<string, Partial<Record<Browser, string>>>();
  let text = "";
  try {
    text = readFileSync(TABLE, "utf8");
  } catch {
    return table;
  }
  for (const line of text.split("\n")) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length !== 4 || cells[0] === "Format" || cells[0]?.startsWith("---")) continue;
    const [name, chromium, firefox, webkit] = cells as [string, string, string, string];
    table.set(name, { chromium, firefox, webkit });
  }
  return table;
}

/**
 * What a run's outcome means in the table. A browser that refuses a format
 * (`DECODE_FAILED`) and one whose decoder never finishes, stopped by the time
 * limit (`TIMEOUT`), both don't decode it: WebKit does either, run to run,
 * with FLAC.
 */
export const cell = (status: string) => (status === "decoded" ? "decodes" : "doesn't decode");
