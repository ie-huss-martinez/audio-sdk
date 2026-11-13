import { probePcm, readPcmFrames } from "../../src/adapters/pcm/probe.js";
import type { AudioMetadata, AudioSampleFormat, DecodedAudio } from "../../src/index.js";
import { EMPTY_METADATA } from "../../src/index.js";
import type { InspectedAudio } from "../contracts/audio-processor.contract.js";

const INFO_FIELDS: Readonly<Record<string, keyof AudioMetadata>> = {
  INAM: "title",
  IART: "artist",
  IPRD: "album",
  ICRD: "year",
  ICMT: "comment",
};

/** The chunks of a RIFF file's top level, by id, with their bodies. */
export function riffChunks(bytes: Uint8Array): { id: string; body: Uint8Array }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: { id: string; body: Uint8Array }[] = [];
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = String.fromCharCode(...bytes.subarray(at, at + 4));
    let size = view.getUint32(at + 4, true);
    if (size === 0xffffffff) size = bytes.length - at - 8;
    chunks.push({ id, body: bytes.subarray(at + 8, at + 8 + size) });
    at += 8 + size + (size % 2);
  }
  return chunks;
}

/** The metadata of a `LIST`/`INFO` chunk, every field empty when there's none. */
export function readInfo(bytes: Uint8Array): AudioMetadata {
  const list = riffChunks(bytes).find(
    ({ id, body }) => id === "LIST" && String.fromCharCode(...body.subarray(0, 4)) === "INFO",
  );
  const metadata: Record<string, string> = { ...EMPTY_METADATA };
  if (!list) return metadata as unknown as AudioMetadata;
  const view = new DataView(list.body.buffer, list.body.byteOffset, list.body.byteLength);
  for (let at = 4; at + 8 <= list.body.length; ) {
    const id = String.fromCharCode(...list.body.subarray(at, at + 4));
    const size = view.getUint32(at + 4, true);
    const value = list.body.subarray(at + 8, at + 8 + size);
    const field = INFO_FIELDS[id];
    if (field) metadata[field] = new TextDecoder().decode(value).replace(/\0+$/, "");
    at += 8 + size + (size % 2);
  }
  return metadata as unknown as AudioMetadata;
}

/** Reads an exported WAV file back through the SDK's own reader. */
export async function inspectWav(output: Blob): Promise<InspectedAudio> {
  const { layout } = await probePcm(output);
  const sampleFormat: AudioSampleFormat =
    layout.encoding === "float" ? "float32" : layout.bytesPerSample === 3 ? "pcm24" : "pcm16";
  return {
    sampleRate: layout.sampleRate,
    sampleFormat,
    metadata: readInfo(new Uint8Array(await output.arrayBuffer())),
    channels: await readPcmFrames(output, layout, 0, layout.frames),
  };
}

/** Decoded audio in memory, standing in for an `AudioBuffer`. */
export function memoryAudio(
  sampleRate: number,
  channels: readonly (readonly number[] | Float32Array)[],
): DecodedAudio {
  const data = channels.map((channel) => Float32Array.from(channel));
  return {
    sampleRate,
    length: data[0]?.length ?? 0,
    numberOfChannels: data.length,
    getChannelData: (channel) => {
      const samples = data[channel];
      if (!samples) throw new RangeError(`No channel ${channel}.`);
      return samples;
    },
  };
}
