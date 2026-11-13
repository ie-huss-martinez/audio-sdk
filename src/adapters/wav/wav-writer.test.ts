import { describe, expect, it } from "vitest";
import { readInfo, riffChunks } from "../../../test/adapters/wav-reader.js";
import { EMPTY_METADATA } from "../../core/model/plan.js";
import { probeWav } from "../pcm/wav.js";
import { encodeSamples, quantise, type WavSpec, wavHeader } from "./wav-writer.js";

const spec = (changes: Partial<WavSpec> = {}): WavSpec => ({
  sampleRate: 48_000,
  channels: 2,
  frames: 100,
  sampleFormat: "pcm16",
  metadata: EMPTY_METADATA,
  ...changes,
});

const fourCc = (bytes: Uint8Array, at: number) =>
  String.fromCharCode(...bytes.subarray(at, at + 4));

describe("quantise", () => {
  it("scales by 2ⁿ⁻¹ and rounds half away from zero", () => {
    expect(quantise(1.5 / 0x8000, "pcm16")).toBe(2);
    expect(quantise(-1.5 / 0x8000, "pcm16")).toBe(-2);
    expect(quantise(0.5 / 0x8000, "pcm16")).toBe(1);
    expect(quantise(-0.5 / 0x8000, "pcm16")).toBe(-1);
    expect(quantise(2.5 / 0x800000, "pcm24")).toBe(3);
    expect(quantise(-2.5 / 0x800000, "pcm24")).toBe(-3);
  });

  it("clamps to full scale, writing +1 as the largest positive value", () => {
    expect(quantise(1, "pcm16")).toBe(0x7fff);
    expect(quantise(4, "pcm16")).toBe(0x7fff);
    expect(quantise(-1, "pcm16")).toBe(-0x8000);
    expect(quantise(-4, "pcm24")).toBe(-0x800000);
    expect(quantise(1, "pcm24")).toBe(0x7fffff);
    expect(quantise(1.5, "float32")).toBe(1);
    expect(quantise(-1.5, "float32")).toBe(-1);
  });

  it("never writes −0 as a PCM sample", () => {
    expect(Object.is(quantise(-1e-30, "pcm16"), 0)).toBe(true);
    expect(Object.is(quantise(-0, "pcm24"), 0)).toBe(true);
  });

  it("writes non-finite samples as silence", () => {
    for (const format of ["pcm16", "pcm24", "float32"] as const) {
      expect(quantise(Number.NaN, format)).toBe(0);
      expect(quantise(Number.POSITIVE_INFINITY, format)).toBe(0);
    }
  });

  it("interleaves 24-bit samples little-endian", () => {
    const bytes = encodeSamples(
      [Float32Array.of(-1), Float32Array.of(0x123456 / 0x800000)],
      1,
      "pcm24",
    );
    expect([...bytes]).toEqual([0x00, 0x00, 0x80, 0x56, 0x34, 0x12]);
  });
});

describe("wavHeader", () => {
  it("writes a plain PCM header that the reader parses, with the data following it", async () => {
    const header = wavHeader(spec());
    expect(fourCc(header, 0)).toBe("RIFF");
    const file = new Uint8Array([...header, ...new Uint8Array(400)]);
    expect(new DataView(file.buffer).getUint32(4, true)).toBe(file.length - 8);
    const layout = await probeWav(new Blob([file]));
    expect(layout).toMatchObject({ sampleRate: 48_000, channels: 2, encoding: "int", frames: 100 });
    expect(layout.dataOffset).toBe(header.length);
  });

  it("uses WAVE_FORMAT_EXTENSIBLE with a speaker mask past stereo or 16 bits, and fact for floats", () => {
    const chunks = riffChunks(wavHeader(spec({ channels: 6, sampleFormat: "float32" })));
    const fmt = chunks.find((chunk) => chunk.id === "fmt ")?.body as Uint8Array;
    const view = new DataView(fmt.buffer, fmt.byteOffset, fmt.byteLength);
    expect(view.getUint16(0, true)).toBe(0xfffe);
    expect(view.getUint32(20, true)).toBe(0x3f);
    expect(view.getUint16(24, true)).toBe(3);
    expect(chunks.map((chunk) => chunk.id)).toEqual(["fmt ", "fact", "data"]);
    expect(riffChunks(wavHeader(spec()))[0]?.body.length).toBe(16);
  });

  it("writes metadata as UTF-8 INFO text, NUL-terminated and padded to even sizes, without empty fields", () => {
    const metadata = { ...EMPTY_METADATA, title: "Entrevista", artist: "Ana Núñez", comment: "ok" };
    const header = wavHeader(spec({ metadata }));
    expect(readInfo(header)).toEqual(metadata);
    const list = riffChunks(header).find((chunk) => chunk.id === "LIST")?.body as Uint8Array;
    const ids: string[] = [];
    const view = new DataView(list.buffer, list.byteOffset, list.byteLength);
    for (let at = 4; at < list.length; ) {
      const size = view.getUint32(at + 4, true);
      ids.push(fourCc(list, at));
      // "Ana Núñez" is 11 bytes in UTF-8, 12 with its NUL: no pad. "ok\0" is 3: one pad byte.
      if (fourCc(list, at) === "ICMT") {
        expect(size).toBe(3);
        expect(list[at + 8 + size]).toBe(0);
      }
      at += 8 + size + (size % 2);
    }
    expect(ids).toEqual(["INAM", "IART", "ICMT"]);
    expect(list.length % 2).toBe(0);
  });

  it("leaves the LIST chunk out when every field is empty", () => {
    expect(riffChunks(wavHeader(spec())).map((chunk) => chunk.id)).toEqual(["fmt ", "data"]);
  });

  it("writes RF64 with a ds64 chunk when the sizes don't fit 32 bits", async () => {
    // Only the header: 2³¹ stereo 16-bit frames is 8 GiB of samples, which
    // is never allocated.
    const frames = 2 ** 31;
    const header = wavHeader(spec({ frames }));
    expect(fourCc(header, 0)).toBe("RF64");
    const view = new DataView(header.buffer);
    expect(view.getUint32(4, true)).toBe(0xffffffff);
    expect(fourCc(header, 12)).toBe("ds64");
    const ds64 = (at: number) =>
      view.getUint32(20 + at, true) + view.getUint32(24 + at, true) * 2 ** 32;
    expect(ds64(8)).toBe(frames * 4);
    expect(ds64(16)).toBe(frames);
    expect(ds64(0)).toBe(header.length - 8 + frames * 4);
    // The reader takes the length from ds64, and reports what's missing.
    const layout = await probeWav(new Blob([header]));
    expect(layout).toMatchObject({ channels: 2, frames: 0, declaredFrames: frames });
  });

  it("stays RIFF just below the 32-bit limit", () => {
    expect(fourCc(wavHeader(spec({ frames: 1_000_000_000 })), 0)).toBe("RIFF");
  });
});
