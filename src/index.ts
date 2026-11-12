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

export type { AudioErrorCode } from "./core/errors/audio-error.js";
export { AudioError, isAudioError } from "./core/errors/audio-error.js";
export type {
  AudioFilePolicy,
  AudioFilePolicyOverrides,
  AudioLimitDefinitions,
  AudioLimitName,
} from "./core/errors/audio-limits.js";
export { audioLimitDefinitions, audioLimits } from "./core/errors/audio-limits.js";
export type { AudioMessageCatalogue } from "./messages/en.js";
export { audioMessages } from "./messages/en.js";
