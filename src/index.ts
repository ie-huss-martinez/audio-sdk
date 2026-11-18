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

export type { AudioAdapters, AudioAdaptersOptions } from "./adapters/audio-adapters.js";
export { createAudioAdapters } from "./adapters/audio-adapters.js";
export type { AudioEngineOptions } from "./adapters/audio-engine.js";
export { createAudioEngine } from "./adapters/audio-engine.js";
export { createAudioOutput } from "./adapters/audio-output.js";
export type { AudioProcessorOptions } from "./adapters/audio-processor.js";
export { createAudioProcessor } from "./adapters/audio-processor.js";
export type { AudioErrorCode } from "./core/errors/audio-error.js";
export { AudioError, isAudioError } from "./core/errors/audio-error.js";
export type {
  AudioFilePolicy,
  AudioFilePolicyOverrides,
  AudioLimitDefinitions,
  AudioLimitName,
} from "./core/errors/audio-limits.js";
export { audioLimitDefinitions, audioLimits } from "./core/errors/audio-limits.js";
export type {
  AudioAssetReference,
  AudioPlanDocumentSource,
} from "./core/format/document-parts.js";
export { AUDIO_PLAN_FORMAT } from "./core/format/document-parts.js";
export type { AudioDocumentRejection, AudioPlanDocument } from "./core/format/plan-document.js";
export {
  AUDIO_PLAN_VERSION,
  readAudioPlanDocument,
  toAudioPlanDocument,
} from "./core/format/plan-document.js";
export type { AudioClipV1, AudioPlanV1 } from "./core/format/version-1.js";
export { migrateAudioCommand, migratePlan } from "./core/format/version-1.js";
export { dbToGain, gainAt } from "./core/model/envelope.js";
export { mixLength } from "./core/model/mix.js";
export type { AudioPeakColumns, AudioPeakColumnsOptions } from "./core/model/peaks.js";
export { peakColumns } from "./core/model/peaks.js";
export type {
  AudioClip,
  AudioClipBody,
  AudioClipProblem,
  AudioFade,
  AudioFadeCurve,
  AudioMetadata,
  AudioPlan,
  AudioTrack,
} from "./core/model/plan.js";
export {
  audibleTracks,
  clipAt,
  clipEnd,
  clipLength,
  EMPTY_METADATA,
  MAX_GAIN_DB,
  MAX_TRACK_NAME_LENGTH,
  MIN_GAIN_DB,
  NO_FADE,
  planLength,
  trackLength,
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
export { MAX_SOURCE_NAME_LENGTH } from "./core/model/source.js";
export { formatTimecode, framesToSeconds, secondsToFrames } from "./core/model/time.js";
export { MAX_METADATA_LENGTH } from "./core/operations/checks.js";
export type {
  AudioAddTrackCommand,
  AudioClipsEdit,
  AudioCommand,
  AudioCommandRejection,
  AudioDeleteRangeCommand,
  AudioInsertClipsCommand,
  AudioInsertTimeCommand,
  AudioKeepRangeCommand,
  AudioMoveClipsCommand,
  AudioMoveTrackCommand,
  AudioPlaceClipsCommand,
  AudioRemoveClipsCommand,
  AudioRemoveTracksCommand,
  AudioReplaceClipsCommand,
  AudioRestoreClipsCommand,
  AudioRestoreTracksCommand,
  AudioSetChannelsCommand,
  AudioSetFadeCommand,
  AudioSetGainCommand,
  AudioSetMasterGainCommand,
  AudioSetMetadataCommand,
  AudioSetTrackCommand,
  AudioSplitClipCommand,
  AudioTrimClipCommand,
  AudioUpdateClipsCommand,
  AudioUserCommand,
} from "./core/operations/commands.js";
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
  AudioRenderResult,
  AudioSampleFormat,
} from "./core/ports/audio-processor.js";
export type {
  AudioCallOptions,
  AudioDecodeOptions,
  AudioProgressOptions,
} from "./core/ports/options.js";
export { connectOutput } from "./core/session/connect-output.js";
export type {
  AudioInsertOptions,
  AudioRecordingFacts,
  AudioSelection,
  AudioSession,
  AudioSessionEvent,
  AudioSessionExportOptions,
  AudioSessionOptions,
  AudioSessionSnapshot,
  AudioSessionStatus,
  AudioWarning,
} from "./core/session/session.js";
export { createAudioSession } from "./core/session/session.js";
export type { AudioFrameScheduler } from "./core/session/watch-playhead.js";
export { watchPlayhead } from "./core/session/watch-playhead.js";
export type { AudioMessageCatalogue } from "./messages/en.js";
export { audioMessages } from "./messages/en.js";
export { audioErrorText, audioWarningText } from "./messages/text.js";
