import type { AudioEngineHarness } from "../contracts/audio-engine.contract.js";
import type { AudioOutputHarness } from "../contracts/audio-output.contract.js";
import type { AudioProcessorHarness } from "../contracts/audio-processor.contract.js";
import { encodeFakeAudio, FAKE_TOLERANCE, fakeDecoded } from "./fake-audio.js";
import { createFakeEngine } from "./fake-engine.js";
import { createFakeOutput } from "./fake-output.js";
import { createFakeProcessor, dequantise, readFakeWav } from "./fake-processor.js";

const SHORT = [[0.1, 0.2, 0.3, 0.4]];

export const fakeEngineHarness: AudioEngineHarness = {
  createEngine: createFakeEngine,
  async file(sampleRate, channels) {
    return encodeFakeAudio({ sampleRate, samples: channels });
  },
  async lyingHeader() {
    return encodeFakeAudio({ sampleRate: 8_000, samples: SHORT, declaredFrames: 1_000_000 });
  },
  async slightlyLong() {
    return encodeFakeAudio({
      sampleRate: 8_000,
      samples: SHORT,
      decoderExtraFrames: FAKE_TOLERANCE,
    });
  },
  async overlong() {
    return encodeFakeAudio({
      sampleRate: 8_000,
      samples: SHORT,
      decoderExtraFrames: FAKE_TOLERANCE + 1,
    });
  },
  async malformed() {
    return new Blob(["FAKEAUDIO1{not json"]);
  },
  async unknown() {
    return new Blob(["RIFX nothing we know"]);
  },
  sampleTolerance: 0,
};

export const fakeProcessorHarness: AudioProcessorHarness = {
  createProcessor: createFakeProcessor,
  decoded: fakeDecoded,
  async inspect(output) {
    const wav = await readFakeWav(output);
    return {
      sampleRate: wav.sampleRate,
      sampleFormat: wav.sampleFormat,
      metadata: wav.metadata,
      channels: wav.samples.map((channel) =>
        Float32Array.from(channel, (value) => dequantise(value, wav.sampleFormat)),
      ),
    };
  },
};

export const fakeOutputHarness: AudioOutputHarness = {
  create() {
    const { output, clock } = createFakeOutput();
    return { output, elapse: async (frames) => clock.advance(frames) };
  },
  decoded: fakeDecoded,
  positionTolerance: 0,
};
