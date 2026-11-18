import {
  type AudioClipBody,
  type AudioFade,
  type AudioFadeCurve,
  clipLength,
  clipProblem,
} from "../model/plan.js";

/**
 * Checks the reducer and the document readers share: shapes, keys, fades
 * and clips, each failing with a stable reason (sdk-core ADR 0045).
 */

/**
 * The longest metadata value, in Unicode code points, so that history steps
 * stay small. Code points are what JSON Schema's `maxLength` counts, and
 * what every language can count, so the limit is the same in every port
 * (sdk-core ADR 0045): 1,000 emoji fit, though they're 2,000 UTF-16 units.
 *
 * @public
 */
export const MAX_METADATA_LENGTH = 1_000;

/**
 * Whether text has more than `max` code points, counted with `for…of`,
 * which walks code points, and stopping as soon as it knows.
 *
 * @internal
 */
export function longerThan(text: string, max: number): boolean {
  // Every code point is one or two UTF-16 units.
  if (text.length <= max) return false;
  let count = 0;
  for (const _ of text) {
    count += 1;
    if (count > max) return true;
  }
  return false;
}

const CURVES: ReadonlySet<string> = new Set<AudioFadeCurve>(["linear", "equalPower"]);

/**
 * The frames of each registered source, or `undefined` for an id the
 * session doesn't have. Sources never change, so the reducer stays pure.
 *
 * @internal
 */
export type SourceFrames = (source: string) => number | undefined;

/**
 * A refusal with its reason, before it becomes the caller's `AudioError`.
 *
 * @internal
 */
export class Invalid extends Error {
  /** A rejection token, such as `unknown-clip`. */
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.reason = reason;
  }
}

/** @internal */
export function invalid(reason: string, message: string): never {
  throw new Invalid(reason, message);
}

/** An object whose fields, from a command that may have been stored or sent, are unchecked. */
export type Unchecked<T> = { readonly [Key in keyof T]?: unknown };

/** @internal */
export function isRecord<T>(value: unknown): value is Unchecked<T> {
  return typeof value === "object" && value !== null;
}

/** @internal */
export function isKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** @internal */
export function isIndex(value: unknown, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
}

/** @internal */
export function fade(value: unknown, name: string): AudioFade {
  if (!isRecord<AudioFade>(value)) invalid("malformed-command", `${name} isn't a fade`);
  onlyFields(value, FADE_FIELDS, name);
  if (typeof value.curve !== "string" || !CURVES.has(value.curve)) {
    invalid("invalid-fade-curve", `${name}'s curve isn't linear or equalPower`);
  }
  return { frames: value.frames as number, curve: value.curve as AudioFadeCurve };
}

const CLIP_FIELDS = ["key", "source", "start", "end", "gainDb", "fadeIn", "fadeOut"];
const FADE_FIELDS = ["frames", "curve"];

/** Fails unless every field the object has is one of `allowed`. */
/** @internal */
export function onlyFields(value: object, allowed: readonly string[], what: string): void {
  for (const [field, content] of Object.entries(value)) {
    if (content !== undefined && !allowed.includes(field)) {
      invalid("malformed-command", `${what} has no field ${field}`);
    }
  }
}

/**
 * A clean copy of a clip's range, gain and fades, with only those fields,
 * or a failure if it isn't valid within its source.
 */
/** @internal */
export function checkClipBody(value: unknown, sourceFrames: SourceFrames): AudioClipBody {
  if (!isRecord<AudioClipBody>(value) || !isKey(value.key) || !isKey(value.source)) {
    invalid("malformed-command", "a clip needs a key and a source");
  }
  onlyFields(value, CLIP_FIELDS, "a clip");
  const clip: AudioClipBody = {
    key: value.key,
    source: value.source,
    start: value.start as number,
    end: value.end as number,
    gainDb: value.gainDb as number,
    fadeIn: fade(value.fadeIn, "fadeIn"),
    fadeOut: fade(value.fadeOut, "fadeOut"),
  };
  const frames = sourceFrames(clip.source);
  if (frames === undefined) invalid("unknown-source", `the session has no source ${clip.source}`);
  const problem = clipProblem(clip, frames);
  if (problem) invalid(problem, `clip ${clip.key} isn't valid within its source`);
  return clip;
}

/**
 * Shortens fades that no longer fit their clip, in proportion, so that
 * neither reaches into the other.
 */
/** @internal */
export function fitFades<Clip extends AudioClipBody>(clip: Clip): Clip {
  const length = clipLength(clip);
  const total = clip.fadeIn.frames + clip.fadeOut.frames;
  // A clip of no frames, or of invalid ones, is left for validation to
  // refuse with its own reason.
  if (total <= length || !(length > 0)) return clip;
  return {
    ...clip,
    fadeIn: { ...clip.fadeIn, frames: Math.floor((clip.fadeIn.frames * length) / total) },
    fadeOut: { ...clip.fadeOut, frames: Math.floor((clip.fadeOut.frames * length) / total) },
  };
}
