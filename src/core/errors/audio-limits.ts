import {
  coreLimits,
  defineLimits,
  type FilePolicy,
  type FilePolicyOverrides,
  type Limits,
} from "@hussmartinez/sdk-core";
import { AudioError } from "./audio-error.js";

/**
 * The audio SDK's limit definitions: sdk-core's core limits with audio
 * defaults, plus five for audio (ADR 0004).
 *
 * | Limit | Code | Default maximum | Default warning |
 * |---|---|---|---|
 * | `maxFileSize` | `FILE_TOO_LARGE` | 1 GB | 250 MB |
 * | `maxFiles` | `TOO_MANY_FILES` | 20 | none |
 * | `maxDecodedSize` | `DECODED_SIZE_TOO_LARGE` | 1 GB | 400 MB |
 * | `maxProcessingTime` | `PROCESSING_TIME_EXCEEDED` | 120 s | none |
 * | `maxDuration` | `DURATION_TOO_LONG` | 3 hours | 1 hour |
 * | `maxChannels` | `TOO_MANY_CHANNELS` | 8 | none |
 * | `maxSampleRate` | `SAMPLE_RATE_TOO_HIGH` | 192 kHz | none |
 * | `maxSessionSize` | `SESSION_TOO_LARGE` | 1.5 GB | 750 MB |
 * | `maxClips` | `TOO_MANY_CLIPS` | 2,000 | none |
 *
 * Sizes are decimal: 1 MB is 1,000,000 bytes. Decoded sizes count 32-bit
 * floats: frames × channels × 4 bytes. `maxDuration` is in milliseconds, and
 * `maxSampleRate` counts samples per second (hertz).
 *
 * @public
 */
export const audioLimitDefinitions = {
  ...coreLimits,
  maxFileSize: { ...coreLimits.maxFileSize, default: 1_000_000_000, warning: 250_000_000 },
  maxDecodedSize: { ...coreLimits.maxDecodedSize, default: 1_000_000_000, warning: 400_000_000 },
  maxDuration: {
    code: "DURATION_TOO_LONG",
    unit: "milliseconds",
    default: 3 * 60 * 60 * 1_000,
    warning: 60 * 60 * 1_000,
  },
  maxChannels: { code: "TOO_MANY_CHANNELS", unit: "count", default: 8 },
  // TODO(sdk-core#59): use a "hertz" unit once LimitUnit has one, before the
  // first release, since `details.unit` is public.
  // https://github.com/ie-huss-martinez/sdk-core/issues/59
  maxSampleRate: { code: "SAMPLE_RATE_TOO_HIGH", unit: "count", default: 192_000 },
  maxSessionSize: {
    code: "SESSION_TOO_LARGE",
    unit: "bytes",
    default: 1_500_000_000,
    warning: 750_000_000,
  },
  maxClips: { code: "TOO_MANY_CLIPS", unit: "count", default: 2_000 },
} as const;

/**
 * The type of {@link audioLimitDefinitions}.
 *
 * @public
 */
export type AudioLimitDefinitions = typeof audioLimitDefinitions;

/**
 * The names of the audio SDK's limits.
 *
 * @public
 */
export type AudioLimitName = keyof AudioLimitDefinitions;

/**
 * A host's `filePolicy`: a new maximum, or `{ maximum, warning }`, for any of
 * the audio SDK's limits. `Infinity` disables a maximum, which removes a
 * protection against hostile files, or disables a warning. Unknown limit
 * names throw `TypeError` when the policy is resolved.
 *
 * @example
 * ```ts
 * // Long recordings: raise the decoded and session sizes together.
 * const filePolicy: AudioFilePolicyOverrides = {
 *   maxDecodedSize: 2e9,
 *   maxSessionSize: { maximum: 3e9, warning: 1.5e9 },
 * };
 * ```
 *
 * @public
 */
export type AudioFilePolicyOverrides = FilePolicyOverrides<AudioLimitDefinitions>;

/**
 * A resolved file policy for the audio SDK. Violations throw
 * {@link AudioError}.
 *
 * @public
 */
export type AudioFilePolicy = FilePolicy<AudioLimitDefinitions>;

/**
 * The audio SDK's limits, ready to resolve a host's `filePolicy`. Violations
 * are thrown as {@link AudioError}, with `details` naming the limit.
 *
 * @example
 * ```ts
 * const policy = audioLimits.resolve(props.filePolicy);
 * policy.check("maxChannels", channels); // throws AudioError("TOO_MANY_CHANNELS") above 8
 * ```
 *
 * @public
 */
export const audioLimits: Limits<AudioLimitDefinitions> = /* @__PURE__ */ defineLimits(
  audioLimitDefinitions,
  { errorClass: AudioError },
);
