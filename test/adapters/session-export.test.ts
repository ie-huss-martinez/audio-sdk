import { expect, it } from "vitest";
import { createEngine, type WritableAudio } from "../../src/adapters/audio-engine.js";
import { createProcessor } from "../../src/adapters/audio-processor.js";
import { webAudioDecoder } from "../../src/adapters/web-audio/platform-decode.js";
import { createAudioSession } from "../../src/index.js";
import { wavFile } from "../fixtures/pcm-files.js";
import { startInProcessWorker } from "./in-process-worker.js";
import { inspectWav } from "./wav-reader.js";

function memoryBuffer(options: {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
}): WritableAudio {
  const data = Array.from(
    { length: options.numberOfChannels },
    () => new Float32Array(options.length),
  );
  return {
    ...options,
    getChannelData: (channel) => data[channel] as Float32Array,
    copyToChannel: (source, channel, start) => (data[channel] as Float32Array).set(source, start),
  };
}

it("opens a WAV file, edits it, and exports it through the real engine and processor", async () => {
  const worker = {
    loadWorker: async () => startInProcessWorker,
    version: __AUDIO_SDK_VERSION__,
    idleTimeout: 0,
  };
  const session = createAudioSession({
    engine: createEngine({
      ...worker,
      createBuffer: memoryBuffer,
      decodePlatform: webAudioDecoder,
    }),
    processor: createProcessor(worker),
  });
  // 16-bit samples that a 16-bit export writes back exactly.
  const tone = Array.from(
    { length: 1_000 },
    (_, i) => Math.round(Math.sin(i / 7) * 20_000) / 0x8000,
  );
  await session.open(new Blob([wavFile([tone, tone.map((x) => -x)])]));
  session.execute({
    type: "audio.deleteRange",
    start: 100,
    end: 400,
    newKey: session.createKey(),
  });
  session.execute({ type: "audio.setMetadata", field: "title", value: "Entrevista" });

  const exported = await inspectWav(await session.export());
  const expected = [...tone.slice(0, 100), ...tone.slice(400)];
  expect(exported).toMatchObject({ sampleFormat: "pcm16", metadata: { title: "Entrevista" } });
  expect([...(exported.channels[0] as Float32Array)]).toEqual(expected.map(Math.fround));
  expect([...(exported.channels[1] as Float32Array)]).toEqual(
    expected.map((x) => Math.fround(-x + 0)),
  );
  await session.close();
});
