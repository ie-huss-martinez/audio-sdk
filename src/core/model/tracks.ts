import type { AudioClip, AudioMetadata } from "./plan.js";

/**
 * The multitrack plan (docs/adr/0006): tracks of clips positioned in time,
 * mixed on playback and export. This module is internal until the session
 * and the worker run on it; nothing here is exported from the package yet.
 */

/**
 * A clip on a track: a range of a source, starting on the timeline frame
 * `at`. A clip's position is stored, so an edit on one track leaves every
 * other clip where it is.
 *
 * @internal
 */
export interface AudioTrackClip extends AudioClip {
  /** The timeline frame the clip starts on. */
  readonly at: number;
}

/**
 * One track: clips in time order that never overlap, with the track's
 * name, gain, mute and solo.
 *
 * @internal
 */
export interface AudioTrack {
  /** Stable across edits. Tracks and clips share one namespace of keys. */
  readonly key: string;
  /**
   * The name people gave it, at most {@link MAX_TRACK_NAME_LENGTH} code
   * points. Empty means none, and an editor shows "Track 2". It's
   * untrusted text: render it as text, never as HTML.
   */
  readonly name: string;
  /** The track's gain in decibels. */
  readonly gainDb: number;
  readonly muted: boolean;
  readonly soloed: boolean;
  /** Sorted by `at`, each ending at or before the next one starts. */
  readonly clips: readonly AudioTrackClip[];
}

/**
 * The session's document, with tracks: every position and length is a whole
 * number of frames at `sampleRate`.
 *
 * @internal
 */
export interface AudioTrackPlan {
  readonly sampleRate: number;
  readonly channels: number;
  /** The master gain in decibels, applied to the mix. */
  readonly gainDb: number;
  /** From top to bottom. A plan always has at least one. */
  readonly tracks: readonly AudioTrack[];
  readonly metadata: AudioMetadata;
}

/**
 * The longest track name, in Unicode code points, as JSON Schema's
 * `maxLength` counts them (sdk-core ADR 0045).
 *
 * @internal
 */
export const MAX_TRACK_NAME_LENGTH = 100;

/**
 * The timeline frame a clip stops before.
 *
 * @internal
 */
export function clipEnd(clip: AudioTrackClip): number {
  return clip.at + (clip.end - clip.start);
}

/**
 * A track's length in frames: where its last clip ends.
 *
 * @internal
 */
export function trackLength(track: AudioTrack): number {
  const last = track.clips.at(-1);
  return last ? clipEnd(last) : 0;
}

/**
 * The plan's length in frames: where the last clip on any track ends.
 * Silence before the first clip is part of the plan.
 *
 * @internal
 */
export function trackPlanLength(plan: AudioTrackPlan): number {
  let length = 0;
  for (const track of plan.tracks) length = Math.max(length, trackLength(track));
  return length;
}

/**
 * The tracks that sound: those that aren't muted and, when any track is
 * soloed, are soloed themselves. It's the one definition that playback,
 * export and an editor's dimming all follow.
 *
 * @internal
 */
export function audibleTracks(plan: AudioTrackPlan): readonly AudioTrack[] {
  const solo = plan.tracks.some((track) => track.soloed);
  return plan.tracks.filter((track) => !track.muted && (!solo || track.soloed));
}

/**
 * What's wrong with the order of a track's clips, or `undefined`:
 *
 * - `clips-out-of-order`: a clip starts before the one listed before it;
 * - `clips-overlap`: a clip starts before the one before it has ended.
 *
 * @internal
 */
export function orderProblem(
  clips: readonly AudioTrackClip[],
): "clips-out-of-order" | "clips-overlap" | undefined {
  for (let i = 1; i < clips.length; i += 1) {
    const before = clips[i - 1] as AudioTrackClip;
    const clip = clips[i] as AudioTrackClip;
    if (clip.at < before.at) return "clips-out-of-order";
    if (clip.at < clipEnd(before)) return "clips-overlap";
  }
  return undefined;
}

/**
 * The index of the first clip that ends after `frame`: the clip that plays
 * the frame, when it has started by then, and otherwise the next one. It's
 * the clips' length when every clip ends at or before the frame. A binary
 * search, because clips are sorted and never overlap.
 *
 * @internal
 */
export function clipIndexAt(clips: readonly AudioTrackClip[], frame: number): number {
  let low = 0;
  let high = clips.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (clipEnd(clips[middle] as AudioTrackClip) > frame) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * The clip that plays a timeline frame on a track, or `undefined` in
 * silence.
 *
 * @internal
 */
export function clipAt(track: AudioTrack, frame: number): AudioTrackClip | undefined {
  const clip = track.clips[clipIndexAt(track.clips, frame)];
  return clip && clip.at <= frame ? clip : undefined;
}
