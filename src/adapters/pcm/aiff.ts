import {
  checkedLayout,
  fourCc,
  invalid,
  MAX_CHUNKS,
  type PcmLayout,
  readBytes,
  unsupported,
} from "./layout.js";

/** AIFC compression types that are uncompressed samples, and how they're stored. */
const AIFC_TYPES: Readonly<
  Record<string, { encoding: PcmLayout["encoding"]; littleEndian: boolean; bits?: number }>
> = {
  NONE: { encoding: "int", littleEndian: false },
  twos: { encoding: "int", littleEndian: false },
  sowt: { encoding: "int", littleEndian: true },
  in24: { encoding: "int", littleEndian: false, bits: 24 },
  "42ni": { encoding: "int", littleEndian: true, bits: 24 },
  in32: { encoding: "int", littleEndian: false, bits: 32 },
  "23ni": { encoding: "int", littleEndian: true, bits: 32 },
  fl32: { encoding: "float", littleEndian: false, bits: 32 },
  FL32: { encoding: "float", littleEndian: false, bits: 32 },
  fl64: { encoding: "float", littleEndian: false, bits: 64 },
  FL64: { encoding: "float", littleEndian: false, bits: 64 },
};

/**
 * Reads an 80-bit IEEE 754 extended-precision number, which AIFF uses for
 * its sample rate. Returns `NaN` for zero, denormal, infinite or NaN values.
 *
 * @internal
 */
export function readExtended(view: DataView, offset: number): number {
  const signAndExponent = view.getUint16(offset, false);
  const exponent = signAndExponent & 0x7fff;
  if (signAndExponent & 0x8000 || exponent === 0 || exponent === 0x7fff) return Number.NaN;
  const mantissa = view.getUint32(offset + 2, false) * 2 ** 32 + view.getUint32(offset + 6, false);
  return mantissa * 2 ** (exponent - 16383 - 63);
}

interface Common {
  readonly channels: number;
  readonly frames: number;
  readonly bits: number;
  readonly sampleRate: number;
  readonly type: string;
}

function readCommon(view: DataView, aifc: boolean): Common {
  if (view.byteLength < (aifc ? 22 : 18)) throw invalid("aiff", "truncated COMM chunk");
  const rate = readExtended(view, 8);
  // Rates such as 44100 are exact in this format; a fractional or absurd
  // rate means a damaged or crafted header.
  if (!Number.isInteger(rate) || rate < 1 || rate > 2 ** 31) {
    throw invalid("aiff", "sample rate out of range");
  }
  return {
    channels: view.getInt16(0, false),
    frames: view.getUint32(2, false),
    bits: view.getInt16(6, false),
    sampleRate: rate,
    type: aifc ? fourCc(view, 18) : "NONE",
  };
}

/**
 * Reads an AIFF or AIFC file's layout: big-endian integer samples, and the
 * AIFC types that are uncompressed (`sowt`, `fl32`, `fl64` and the like).
 * A frame count in `COMM` beyond the `SSND` bytes the file holds, as in a
 * truncated file, opens with the whole frames that are there, and reports
 * the declared count (docs/adr/0001).
 *
 * @internal
 */
export async function probeAiff(file: Blob): Promise<PcmLayout> {
  const header = await readBytes(file, 0, 12);
  const form = fourCc(header, 8);
  if (fourCc(header) !== "FORM" || (form !== "AIFF" && form !== "AIFC")) {
    throw invalid("aiff", "missing FORM header");
  }
  const aifc = form === "AIFC";

  let common: Common | undefined;
  let sound: { offset: number; size: number } | undefined;
  let offset = 12;

  for (let chunks = 0; offset + 8 <= file.size; chunks += 1) {
    if (chunks >= MAX_CHUNKS) throw invalid("aiff", "too many chunks");
    const head = await readBytes(file, offset, 8);
    const id = fourCc(head);
    const size = head.getUint32(4, false);
    const bodyOffset = offset + 8;
    const available = file.size - bodyOffset;

    if (id === "COMM") {
      if (size > available) throw invalid("aiff", "truncated COMM chunk");
      common = readCommon(await readBytes(file, bodyOffset, Math.min(size, 64)), aifc);
    } else if (id === "SSND") {
      const body = await readBytes(file, bodyOffset, 8);
      if (size < 8 || body.byteLength < 8) throw invalid("aiff", "truncated SSND chunk");
      const dataOffset = bodyOffset + 8 + body.getUint32(0, false);
      // The chunk may claim more than the file has; only what's there counts.
      const end = Math.min(bodyOffset + size, file.size);
      if (dataOffset > end) throw invalid("aiff", "sound data offset past the chunk");
      sound = { offset: dataOffset, size: end - dataOffset };
    }

    if (common && sound) break;
    offset = bodyOffset + size + (size % 2);
  }

  if (!common) throw invalid("aiff", "missing COMM chunk");
  if (!sound) throw invalid("aiff", "missing SSND chunk");

  const type = AIFC_TYPES[common.type];
  if (!type) throw unsupported("aiff", common.type || "unknown");
  const bits = type.bits ?? common.bits;
  if (bits < 1 || bits > 64) throw invalid("aiff", "sample size out of range");
  if (type.encoding === "float" && bits !== 32 && bits !== 64) {
    throw unsupported("aiff", `${bits}-bit float`);
  }
  if (type.encoding === "int" && bits > 32) throw unsupported("aiff", `${bits}-bit integer`);
  // Integer samples narrower than their bytes are stored left-justified, so
  // reading the whole bytes gives the right value.
  const bytesPerSample = Math.ceil(bits / 8);

  const layout = checkedLayout({
    container: "aiff",
    sampleRate: common.sampleRate,
    channels: common.channels,
    encoding: type.encoding,
    bytesPerSample,
    littleEndian: type.littleEndian,
    dataOffset: sound.offset,
    blockAlign: common.channels * bytesPerSample,
    frames: common.frames,
  });
  // A truncated file opens with the whole frames that are there, and reports
  // the declared count (docs/adr/0001).
  if (layout.frames * layout.blockAlign > sound.size) {
    return {
      ...layout,
      frames: Math.floor(sound.size / layout.blockAlign),
      declaredFrames: layout.frames,
    };
  }
  return layout;
}
