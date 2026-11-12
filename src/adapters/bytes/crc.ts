/**
 * Table-driven CRCs for the containers the probe walks: FLAC's CRC-8 and
 * CRC-16, and Ogg's CRC-32. All are non-reflected, with an initial value of
 * zero.
 */

function table(width: 8 | 16 | 32, polynomial: number): Uint32Array {
  const top = 2 ** (width - 1);
  const mask = 2 ** width - 1;
  const entries = new Uint32Array(256);
  for (let byte = 0; byte < 256; byte += 1) {
    let crc = byte * 2 ** (width - 8);
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc >= top ? ((crc * 2) ^ polynomial) & mask : (crc * 2) & mask;
      crc >>>= 0;
    }
    entries[byte] = crc >>> 0;
  }
  return entries;
}

const CRC8 = table(8, 0x07);
const CRC16 = table(16, 0x8005);
const CRC32 = table(32, 0x04c11db7);

/** FLAC's frame header CRC-8 (polynomial x⁸ + x² + x + 1). @internal */
export function crc8(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0;
  for (let i = start; i < end; i += 1) crc = CRC8[crc ^ (bytes[i] as number)] as number;
  return crc;
}

/** One step of FLAC's frame CRC-16 (polynomial x¹⁶ + x¹⁵ + x² + 1). @internal */
export function crc16Step(crc: number, byte: number): number {
  return ((crc << 8) ^ (CRC16[(crc >> 8) ^ byte] as number)) & 0xffff;
}

/** Ogg's page CRC-32 (polynomial 0x04C11DB7). @internal */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0;
  for (let i = start; i < end; i += 1) {
    crc = ((crc << 8) ^ (CRC32[((crc >>> 24) ^ (bytes[i] as number)) & 0xff] as number)) >>> 0;
  }
  return crc >>> 0;
}
