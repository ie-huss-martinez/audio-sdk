import { abortError, throwIfAborted } from "../../src/core/errors/abort.js";
import {
  type AudioEngine,
  AudioError,
  type AudioPeakLevel,
  type AudioProbe,
} from "../../src/index.js";
import { decodeFakeAudio, FAKE_TOLERANCE, fakeDecoded } from "./fake-audio.js";

const FINEST_BUCKET = 4;

/** An in-memory engine over the fake audio format, with the real engine's rules. */
export function createFakeEngine(): AudioEngine {
  let destroyed = false;
  const assertAlive = () => {
    if (destroyed) throw new Error("The engine has been destroyed.");
  };

  async function read(file: Blob, signal: AbortSignal | undefined) {
    const parsed = await decodeFakeAudio(file);
    throwIfAborted(signal);
    if (parsed === undefined) {
      throw new AudioError("UNSUPPORTED_FORMAT", "Not a recognised container.");
    }
    if (parsed === "invalid") {
      throw new AudioError("INVALID_AUDIO", "Malformed fake audio.", {
        details: { container: "wav" },
      });
    }
    return parsed;
  }

  return {
    async probe(file, options = {}) {
      assertAlive();
      throwIfAborted(options.signal);
      const parsed = await read(file, options.signal);
      // The bound comes from the samples, the fake's "packets", never the header.
      const frameBound = parsed.samples[0]?.length ?? 0;
      const declared = parsed.declaredFrames ?? frameBound;
      if (declared > frameBound && !parsed.truncated) {
        throw new AudioError("INVALID_AUDIO", "The header claims more than the packets carry.", {
          details: { container: "wav" },
        });
      }
      return {
        container: "wav",
        codec: "pcm",
        sampleRate: parsed.sampleRate,
        channels: Math.max(parsed.samples.length, parsed.probeChannels ?? 0),
        frameBound,
        expectedFrames: Math.min(declared, frameBound),
        ...(declared > frameBound ? { declaredFrames: declared } : {}),
        frameTolerance: FAKE_TOLERANCE,
      } satisfies AudioProbe;
    },

    async decode(file, probe, options = {}) {
      assertAlive();
      throwIfAborted(options.signal);
      const parsed = await read(file, options.signal);
      if (parsed.undecodable) {
        throw new AudioError("DECODE_FAILED", "The fake browser lacks this codec.", {
          details: { codec: probe.codec },
        });
      }
      const extra = parsed.decoderExtraFrames ?? 0;
      const channels = parsed.samples.map((channel) => [
        ...channel,
        ...new Array<number>(extra).fill(0),
      ]);
      const length = channels[0]?.length ?? 0;
      if (length > probe.frameBound + probe.frameTolerance) {
        throw new AudioError("INVALID_AUDIO", "Decoded to more than the probe's bound.", {
          details: { container: probe.container },
        });
      }
      options.onProgress?.(1);
      // The decoded length, capped at the bound (ADR 0004).
      const capped = Math.min(length, probe.frameBound);
      return fakeDecoded(
        probe.sampleRate,
        channels.map((channel) => channel.slice(0, capped)),
      );
    },

    async peaks(audio, options = {}) {
      assertAlive();
      if (options.signal?.aborted) throw abortError(options.signal);
      const levels: AudioPeakLevel[] = [];
      for (let bucket = FINEST_BUCKET; ; bucket *= 4) {
        const count = Math.ceil(audio.length / bucket);
        const channels = [];
        for (let c = 0; c < audio.numberOfChannels; c += 1) {
          const data = audio.getChannelData(c);
          const min = new Float32Array(count);
          const max = new Float32Array(count);
          for (let i = 0; i < count; i += 1) {
            const part = data.subarray(i * bucket, (i + 1) * bucket);
            min[i] = Math.min(...part);
            max[i] = Math.max(...part);
          }
          channels.push({ min, max });
        }
        levels.push({ framesPerBucket: bucket, channels });
        if (count <= 1) break;
      }
      return { levels };
    },

    async destroy() {
      destroyed = true;
    },
  };
}
