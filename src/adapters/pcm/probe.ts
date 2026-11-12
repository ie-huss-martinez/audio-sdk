import { AudioError } from "../../core/errors/audio-error.js";
import type { AudioProbe } from "../../core/model/source.js";
import { probeAiff } from "./aiff.js";
import { fourCc, invalid, type PcmLayout, readBytes } from "./layout.js";
import { decodeFrames } from "./samples.js";
import { probeWav } from "./wav.js";

/**
 * Probes an uncompressed file: WAV or AIFF. Anything else fails closed with
 * `UNSUPPORTED_FORMAT`, so it's never handed to a decoder (docs/adr/0001).
 * The compressed containers' packet walkers join this in their own pull
 * requests.
 *
 * @internal
 */
export async function probePcm(file: Blob): Promise<{ probe: AudioProbe; layout: PcmLayout }> {
  const header = await readBytes(file, 0, 12);
  const magic = fourCc(header);
  const form = fourCc(header, 8);
  let layout: PcmLayout;
  if ((magic === "RIFF" || magic === "RF64") && form === "WAVE") {
    layout = await probeWav(file);
  } else if (magic === "FORM" && (form === "AIFF" || form === "AIFC")) {
    layout = await probeAiff(file);
  } else {
    throw new AudioError("UNSUPPORTED_FORMAT", "The file's container isn't recognised.", {
      details: { container: "unknown" },
    });
  }
  if (layout.frames === 0) throw invalid(layout.container, "no audio frames");
  return {
    layout,
    probe: {
      container: layout.container,
      codec: "pcm",
      sampleRate: layout.sampleRate,
      channels: layout.channels,
      // An uncompressed file's length is exact: its decoder can't return more.
      frameBound: layout.frames,
      expectedFrames: layout.frames,
      ...(layout.declaredFrames === undefined ? {} : { declaredFrames: layout.declaredFrames }),
      frameTolerance: 0,
    },
  };
}

/**
 * Reads `frames` frames from `start` as 32-bit floats per channel.
 *
 * @throws `RangeError` for a range outside the file's frames, and
 *   `INVALID_AUDIO` when the file is shorter than its layout says, as when
 *   it changed after it was probed.
 * @internal
 */
export async function readPcmFrames(
  file: Blob,
  layout: PcmLayout,
  start: number,
  frames: number,
): Promise<Float32Array[]> {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(frames) ||
    start < 0 ||
    frames < 0 ||
    start + frames > layout.frames
  ) {
    throw new RangeError(`Frames ${start} to ${start + frames} are outside the file.`);
  }
  const length = frames * layout.blockAlign;
  const view = await readBytes(file, layout.dataOffset + start * layout.blockAlign, length);
  if (view.byteLength < length) throw invalid(layout.container, "file shorter than probed");
  return decodeFrames(view, layout, frames);
}
