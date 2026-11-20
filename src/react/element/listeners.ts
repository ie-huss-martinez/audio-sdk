import { createContext } from "react";
import type { AudioErrorCode } from "../../core/errors/audio-error.js";
import type { AudioSampleFormat } from "../../core/ports/audio-processor.js";

/**
 * What the export dialog reports when an export finishes: the format, the
 * file's size and what clamping did, with no file name or contents
 * (sdk-core ADR 0012). The element fires it as its `export` event.
 *
 * @public
 */
export interface AudioExportReport {
  readonly sampleFormat: AudioSampleFormat;
  /** The file's size in bytes. */
  readonly size: number;
  /** The mix's peak before clamping, in dB relative to full scale. */
  readonly peakDb: number;
  /** How many frames were clamped to full scale. */
  readonly clippedFrames: number;
}

/**
 * What the element listens to inside the editor, without props on the
 * public components (docs/adr/0005): an export the dialog finished, and a
 * failure the editor shows.
 *
 * @internal
 */
export interface ElementListeners {
  readonly onExport?: (report: AudioExportReport) => void;
  readonly onError?: (error: {
    readonly code: AudioErrorCode;
    readonly details: Readonly<Record<string, unknown>>;
  }) => void;
}

/** @internal */
export const ElementListenersContext = /* @__PURE__ */ createContext<ElementListeners>({});
