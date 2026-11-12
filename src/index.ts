/**
 * Headless core of the audio SDK: contracts, errors, the document session and
 * operations.
 *
 * @remarks
 * This entry is server-safe: it has no React and touches no DOM on import, so
 * Server Components and Node can import it (ADR 0004, ADR 0007).
 *
 * @packageDocumentation
 */

export type { AudioEngineOptions } from "./adapters/audio-engine.js";
export { createAudioEngine } from "./adapters/audio-engine.js";
export type { AudioErrorCode } from "./core/errors/audio-error.js";
export { AudioError, isAudioError } from "./core/errors/audio-error.js";
export type {
  AudioFilePolicy,
  AudioFilePolicyOverrides,
  AudioLimitDefinitions,
  AudioLimitName,
} from "./core/errors/audio-limits.js";
export { audioLimitDefinitions, audioLimits } from "./core/errors/audio-limits.js";
export { dbToGain, gainAt } from "./core/model/envelope.js";
export type {
  AudioClip,
  AudioFade,
  AudioFadeCurve,
  AudioMetadata,
  AudioPlan,
} from "./core/model/plan.js";
export {
  clipLength,
  clipOffsets,
  EMPTY_METADATA,
  NO_FADE,
  planLength,
} from "./core/model/plan.js";
export type {
  AudioCodec,
  AudioContainer,
  AudioPeakLevel,
  AudioPeaks,
  AudioProbe,
  AudioSourceInfo,
  DecodedAudio,
} from "./core/model/source.js";
export { framesToSeconds, secondsToFrames } from "./core/model/time.js";
export type { AudioEngine } from "./core/ports/audio-engine.js";
export type {
  AudioOutput,
  AudioOutputSnapshot,
  AudioOutputState,
} from "./core/ports/audio-output.js";
export type {
  AudioExportFormat,
  AudioProcessor,
  AudioRenderJob,
  AudioSampleFormat,
} from "./core/ports/audio-processor.js";
export type { AudioCallOptions, AudioProgressOptions } from "./core/ports/options.js";
export type { AudioMessageCatalogue } from "./messages/en.js";
export { audioMessages } from "./messages/en.js";
