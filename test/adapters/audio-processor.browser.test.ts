import { createAudioProcessor, type DecodedAudio } from "../../src/index.js";
import { describeAudioProcessorContract } from "../contracts/audio-processor.contract.js";
import { inspectWav } from "./wav-reader.js";

/** A real AudioBuffer holding these samples. */
function audioBuffer(sampleRate: number, channels: readonly (readonly number[])[]): DecodedAudio {
  const buffer = new AudioBuffer({
    sampleRate,
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
  });
  for (const [channel, samples] of channels.entries()) {
    buffer.copyToChannel(Float32Array.from(samples), channel);
  }
  return buffer;
}

// The inlined worker, as applications get it by default.
describeAudioProcessorContract("audio processor, in the browser", {
  createProcessor: () => createAudioProcessor(),
  decoded: audioBuffer,
  inspect: inspectWav,
});
