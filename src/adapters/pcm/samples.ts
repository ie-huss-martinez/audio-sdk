import type { PcmLayout } from "./layout.js";

/**
 * Converts `frames` frames of raw samples, starting at the view's first
 * byte, to 32-bit floats per channel. Integers are scaled by their stored
 * width, so `-1` is the most negative value. Floats keep values beyond full
 * scale, which float files may legitimately hold, but anything that isn't a
 * finite 32-bit float, including a 64-bit value too large for one, becomes
 * silence rather than spreading `NaN` or `Infinity` through every later
 * calculation.
 *
 * @internal
 */
export function decodeFrames(view: DataView, layout: PcmLayout, frames: number): Float32Array[] {
  const { channels, bytesPerSample, blockAlign, encoding, littleEndian } = layout;
  if (view.byteLength < frames * blockAlign) {
    throw new RangeError(`Expected ${frames * blockAlign} bytes, got ${view.byteLength}.`);
  }
  const output = Array.from({ length: channels }, () => new Float32Array(frames));
  const read = sampleReader(encoding, bytesPerSample, littleEndian);
  for (let c = 0; c < channels; c += 1) {
    const target = output[c] as Float32Array;
    let offset = c * bytesPerSample;
    for (let i = 0; i < frames; i += 1) {
      target[i] = read(view, offset);
      offset += blockAlign;
    }
  }
  return output;
}

type Reader = (view: DataView, offset: number) => number;

function sampleReader(
  encoding: PcmLayout["encoding"],
  bytes: number,
  littleEndian: boolean,
): Reader {
  if (encoding === "float") {
    return bytes === 8
      ? (view, offset) => finite(Math.fround(view.getFloat64(offset, littleEndian)))
      : (view, offset) => finite(view.getFloat32(offset, littleEndian));
  }
  if (encoding === "uint") {
    return (view, offset) => (view.getUint8(offset) - 128) / 128;
  }
  switch (bytes) {
    case 1:
      return (view, offset) => view.getInt8(offset) / 128;
    case 2:
      return (view, offset) => view.getInt16(offset, littleEndian) / 32_768;
    case 3:
      return (view, offset) => {
        const b0 = view.getUint8(offset);
        const b1 = view.getUint8(offset + 1);
        const b2 = view.getUint8(offset + 2);
        const value = littleEndian ? b0 | (b1 << 8) | (b2 << 16) : (b0 << 16) | (b1 << 8) | b2;
        // Sign-extend from 24 bits.
        return ((value << 8) >> 8) / 8_388_608;
      };
    default:
      return (view, offset) => view.getInt32(offset, littleEndian) / 2_147_483_648;
  }
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
