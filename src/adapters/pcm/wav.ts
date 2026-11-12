import {
  checkedLayout,
  fourCc,
  invalid,
  MAX_CHUNKS,
  type PcmLayout,
  readBytes,
  unsupported,
} from "./layout.js";

const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;
/** The tail every `KSDATAFORMAT_SUBTYPE_*` GUID shares after its format tag. */
const SUBTYPE_TAIL = [
  0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
];
/** A data size writers use when they don't know the length yet, as when streaming. */
const UNKNOWN_SIZE = 0xffffffff;

interface Format {
  readonly tag: number;
  readonly channels: number;
  readonly sampleRate: number;
  readonly blockAlign: number;
  readonly bitsPerSample: number;
}

function readFormat(view: DataView): Format {
  if (view.byteLength < 16) throw invalid("wav", "truncated fmt chunk");
  let tag = view.getUint16(0, true);
  const format = {
    channels: view.getUint16(2, true),
    sampleRate: view.getUint32(4, true),
    blockAlign: view.getUint16(12, true),
    bitsPerSample: view.getUint16(14, true),
  };
  if (tag === WAVE_FORMAT_EXTENSIBLE) {
    if (view.byteLength < 40) throw invalid("wav", "truncated extensible fmt chunk");
    tag = view.getUint16(24, true);
    for (const [index, byte] of SUBTYPE_TAIL.entries()) {
      if (view.getUint8(26 + index) !== byte) throw unsupported("wav", "extensible subformat");
    }
  }
  return { tag, ...format };
}

function layoutOf(format: Format, dataOffset: number, dataSize: number): PcmLayout {
  const { tag, channels, sampleRate, blockAlign, bitsPerSample } = format;
  if (bitsPerSample % 8 !== 0) throw invalid("wav", "sample size isn't whole bytes");
  const bytesPerSample = bitsPerSample / 8;
  let encoding: PcmLayout["encoding"];
  if (tag === WAVE_FORMAT_PCM && [1, 2, 3, 4].includes(bytesPerSample)) {
    encoding = bytesPerSample === 1 ? "uint" : "int";
  } else if (tag === WAVE_FORMAT_IEEE_FLOAT && [4, 8].includes(bytesPerSample)) {
    encoding = "float";
  } else {
    throw unsupported("wav", `format ${tag} at ${bitsPerSample} bits`);
  }
  if (blockAlign < 1) throw invalid("wav", "frame size is zero");
  return checkedLayout({
    container: "wav",
    sampleRate,
    channels,
    encoding,
    bytesPerSample,
    littleEndian: true,
    dataOffset,
    blockAlign,
    frames: Math.floor(dataSize / blockAlign),
  });
}

/**
 * Reads a WAV file's layout: RIFF or RF64, PCM or float, plain or
 * extensible. The data size is checked against the bytes the file has: a
 * header that claims more fails with `INVALID_AUDIO` (docs/adr/0001). Only
 * a size of 0 or 0xFFFFFFFF, which writers use when streaming, means "to
 * the end of the file".
 *
 * @internal
 */
export async function probeWav(file: Blob): Promise<PcmLayout> {
  const header = await readBytes(file, 0, 12);
  const riff = fourCc(header);
  if ((riff !== "RIFF" && riff !== "RF64") || fourCc(header, 8) !== "WAVE") {
    throw invalid("wav", "missing RIFF header");
  }

  let format: Format | undefined;
  let data: { offset: number; size: number } | undefined;
  let rf64DataSize: number | undefined;
  let offset = 12;

  for (let chunks = 0; offset + 8 <= file.size; chunks += 1) {
    if (chunks >= MAX_CHUNKS) throw invalid("wav", "too many chunks");
    const head = await readBytes(file, offset, 8);
    const id = fourCc(head);
    const size = head.getUint32(4, true);
    const bodyOffset = offset + 8;
    const available = file.size - bodyOffset;

    if (id === "ds64" && riff === "RF64") {
      const body = await readBytes(file, bodyOffset, 16);
      if (body.byteLength < 16) throw invalid("wav", "truncated ds64 chunk");
      const high = body.getUint32(12, true);
      if (high >= 2 ** 21) throw invalid("wav", "data size out of range");
      rf64DataSize = high * 2 ** 32 + body.getUint32(8, true);
    } else if (id === "fmt ") {
      if (size > available) throw invalid("wav", "truncated fmt chunk");
      format = readFormat(await readBytes(file, bodyOffset, Math.min(size, 64)));
    } else if (id === "data") {
      let dataSize = size;
      if (riff === "RF64" && size === UNKNOWN_SIZE) {
        if (rf64DataSize === undefined) throw invalid("wav", "RF64 file without ds64 chunk");
        dataSize = rf64DataSize;
      } else if (size === UNKNOWN_SIZE || size === 0) {
        dataSize = available;
      }
      if (dataSize > available) throw invalid("wav", "data size exceeds the file");
      data = { offset: bodyOffset, size: dataSize };
      if (format) break;
      offset = bodyOffset + dataSize + (dataSize % 2);
      continue;
    }

    if (format && data) break;
    // Chunks are padded to an even size.
    offset = bodyOffset + size + (size % 2);
  }

  if (!format) throw invalid("wav", "missing fmt chunk");
  if (!data) throw invalid("wav", "missing data chunk");
  return layoutOf(format, data.offset, data.size);
}
