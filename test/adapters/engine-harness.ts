import type { AudioEngine } from "../../src/index.js";
import type { AudioEngineHarness } from "../contracts/audio-engine.contract.js";
import { wavFile } from "../fixtures/pcm-files.js";

const SHORT = [[0.1, 0.2, 0.3, 0.4]];

/** The engine contract's files, as real WAV files, for the SDK's own engine. */
export function wavEngineHarness(createEngine: () => AudioEngine): AudioEngineHarness {
  return {
    createEngine,
    async file(sampleRate, channels) {
      return new Blob([wavFile(channels, { sampleRate, format: "float32" })]);
    },
    async lyingHeader() {
      return new Blob([wavFile(SHORT, { dataSize: 1_000_000 })]);
    },
    async malformed() {
      const bytes = wavFile(SHORT);
      // A channel count of zero in the fmt chunk.
      new DataView(bytes.buffer).setUint16(22, 0, true);
      return new Blob([bytes]);
    },
    async unknown() {
      return new Blob([new TextEncoder().encode("OggS\0\x02 not a container we know")]);
    },
    // Float WAV is lossless.
    sampleTolerance: 0,
  };
}
