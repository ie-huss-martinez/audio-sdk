/**
 * The containers the probe recognises (ADR 0001).
 *
 * @public
 */
export type AudioContainer = "wav" | "aiff" | "flac" | "ogg" | "mp3" | "adts" | "mp4" | "webm";

/**
 * The codecs the probe recognises (ADR 0001). `pcm` covers integer and
 * floating-point samples in WAV and AIFF.
 *
 * @public
 */
export type AudioCodec = "pcm" | "mp3" | "aac" | "alac" | "opus" | "vorbis" | "flac";

/**
 * What the probe learned about a file before anything decodes it (ADR 0001,
 * ADR 0004). Limits are checked against it.
 *
 * @public
 */
export interface AudioProbe {
  readonly container: AudioContainer;
  readonly codec: AudioCodec;
  /** The sample rate the decoder will output, which can differ from the header's, as for Opus. */
  readonly sampleRate: number;
  /** The channel count the decoder will output, which can differ from the header's. */
  readonly channels: number;
  /**
   * The most frames the decoder can output, at {@link AudioProbe.sampleRate}
   * and {@link AudioProbe.channels}: the exact length of an uncompressed
   * file, or the sum over every packet of a compressed one, never a count
   * declared in a header. A packet that could decode to more channels, or
   * at a lower rate that's then resampled, counts as the frames that cover
   * it, so `frameBound × channels × 4` bounds the decoded bytes.
   */
  readonly frameBound: number;
  /**
   * The expected length in frames: a header's count when it's within
   * {@link AudioProbe.frameBound}, otherwise the bound itself.
   */
  readonly expectedFrames: number;
  /**
   * How many frames beyond {@link AudioProbe.frameBound} a decoder may
   * legitimately return, such as one or two codec frames for encoder delay,
   * priming or pre-skip. A longer result fails with `INVALID_AUDIO`.
   */
  readonly frameTolerance: number;
}

/**
 * Decoded audio, as 32-bit float samples per channel. A Web Audio
 * `AudioBuffer` is one, and tests can supply their own.
 *
 * @public
 */
export interface DecodedAudio {
  readonly sampleRate: number;
  /** The length in frames. */
  readonly length: number;
  readonly numberOfChannels: number;
  /** The samples of one channel. The caller must not modify them. */
  getChannelData(channel: number): Float32Array;
}

/**
 * One level of a waveform overview: the lowest and highest sample of each
 * bucket of frames, per channel.
 *
 * @public
 */
export interface AudioPeakLevel {
  /** How many frames each bucket covers. */
  readonly framesPerBucket: number;
  /** For each channel, the minimum and maximum sample of each bucket. */
  readonly channels: readonly { readonly min: Float32Array; readonly max: Float32Array }[];
}

/**
 * A source's waveform overview, a min/max pyramid at several zoom levels,
 * computed once so that drawing the waveform never scans samples (ADR 0002).
 * Levels are ordered from the finest to the coarsest.
 *
 * @public
 */
export interface AudioPeaks {
  readonly levels: readonly AudioPeakLevel[];
}

/**
 * A source the session holds, without its samples: what the snapshot shows
 * (ADR 0003).
 *
 * @public
 */
export interface AudioSourceInfo {
  readonly id: string;
  readonly sampleRate: number;
  readonly channels: number;
  /** The length in frames: the decoded length, capped at the probe's bound (ADR 0004). */
  readonly frames: number;
  readonly container: AudioContainer;
  readonly codec: AudioCodec;
}
