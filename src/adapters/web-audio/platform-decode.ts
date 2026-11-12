import { abortError, throwIfAborted } from "../../core/errors/abort.js";
import { AudioError, isAudioError } from "../../core/errors/audio-error.js";
import type { AudioProbe, DecodedAudio } from "../../core/model/source.js";

/**
 * Decodes a file's bytes with a platform decoder, at the given rate and
 * channel count. The SDK's is Web Audio's; tests pass their own.
 *
 * @internal
 */
export type PlatformDecoder = (
  bytes: ArrayBuffer,
  format: { readonly sampleRate: number; readonly channels: number },
) => Promise<DecodedAudio>;

/** A buffer the decoded audio can be copied into, when it must be shortened. */
export type CreateBuffer = (options: {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
}) => DecodedAudio & {
  copyToChannel(source: Float32Array, channel: number, startInChannel: number): void;
};

/**
 * Web Audio's decoder: `decodeAudioData` on a fresh `OfflineAudioContext` at
 * the file's probed rate, so nothing is resampled (docs/adr/0001). It exists
 * only on the page.
 *
 * @internal
 */
export const webAudioDecoder: PlatformDecoder = (bytes, { sampleRate, channels }) => {
  const Offline = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext })
    .OfflineAudioContext;
  if (typeof Offline !== "function") {
    throw new AudioError("UNSUPPORTED_ENVIRONMENT", "Web Audio isn't available.", {
      details: { feature: "OfflineAudioContext" },
    });
  }
  let context: OfflineAudioContext;
  try {
    context = new Offline({ numberOfChannels: channels, length: 1, sampleRate });
  } catch (error) {
    throw new AudioError("UNSUPPORTED_FORMAT", "This browser can't decode at this rate.", {
      details: { sampleRate },
      cause: error,
    });
  }
  return context.decodeAudioData(bytes);
};

/** Settles with the decode, or rejects as soon as the signal aborts. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  // A result that arrives after an abort is dropped, and so is a late
  // failure, which would otherwise be reported as unhandled.
  work.catch(() => {});
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Decodes a probed compressed file on the page, under sdk-core ADR 0031's
 * rules for platform decoders that only run there:
 *
 * - **Only probed files:** the caller passes the probe that walked this
 *   file's packets, and the limits have been checked against its bound.
 * - **A fresh buffer:** the decoder gets bytes read from the `Blob` for it,
 *   which it may detach; no caller-owned buffer is ever handed over.
 * - **The output is checked against the bound:** a different rate or
 *   channel count, or more frames than the bound plus the codec's tolerance,
 *   fails with `INVALID_AUDIO`, and the output is discarded. A result within
 *   the tolerance but past the bound is shortened to the bound.
 * - **Never the decoder's errors:** a failure becomes `DECODE_FAILED`, with
 *   `details` naming the container and codec, never the browser's message,
 *   which is kept only as the error's `cause`.
 * - **The time limit:** a page-side decode can't be terminated, so when the
 *   signal aborts, as `maxProcessingTime` does, it stops waiting and rejects
 *   with the abort's code, such as `PROCESSING_TIME_EXCEEDED`; the result is
 *   discarded whenever it arrives.
 *
 * @internal
 */
export async function decodeOnPage(
  file: Blob,
  probe: AudioProbe,
  decoder: PlatformDecoder,
  createBuffer: CreateBuffer,
  signal?: AbortSignal,
): Promise<DecodedAudio> {
  const { container, codec, sampleRate, channels, frameBound, frameTolerance } = probe;
  throwIfAborted(signal);
  const bytes = await untilAborted(file.arrayBuffer(), signal);

  let decoded: DecodedAudio;
  try {
    decoded = await untilAborted(
      Promise.resolve().then(() => decoder(bytes, { sampleRate, channels })),
      signal,
    );
  } catch (error) {
    if (isAudioError(error)) throw error;
    throw new AudioError("DECODE_FAILED", "The browser couldn't decode this file.", {
      details: { container, codec },
      cause: error,
    });
  }

  const invalid = (reason: string) =>
    new AudioError("INVALID_AUDIO", `The decoded audio ${reason}.`, {
      details: { container, codec, reason: `decoded ${reason}` },
    });
  if (decoded.sampleRate !== sampleRate) throw invalid("rate differs from the probe");
  if (decoded.numberOfChannels !== channels) throw invalid("channel count differs from the probe");
  if (decoded.length > frameBound + frameTolerance) throw invalid("length exceeds the bound");
  if (decoded.length <= frameBound) return decoded;

  // Within the tolerance but past the bound: the source is the bound's length.
  const capped = createBuffer({ numberOfChannels: channels, length: frameBound, sampleRate });
  for (let c = 0; c < channels; c += 1) {
    capped.copyToChannel(decoded.getChannelData(c).subarray(0, frameBound), c, 0);
  }
  return capped;
}
