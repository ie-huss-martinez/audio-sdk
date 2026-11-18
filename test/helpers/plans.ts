import {
  type AudioClip,
  type AudioClipBody,
  type AudioMetadata,
  type AudioPlan,
  type AudioTrack,
  EMPTY_METADATA,
} from "../../src/index.js";

/** A track with the defaults: unnamed, at 0 dB, neither muted nor soloed. */
export function trackOf(
  key: string,
  clips: readonly AudioClip[],
  extra: Partial<AudioTrack> = {},
): AudioTrack {
  return { key, name: "", gainDb: 0, muted: false, soloed: false, clips, ...extra };
}

/** Clips placed back to back from the start, as one recording plays. */
export function backToBack(clips: readonly AudioClipBody[]): AudioClip[] {
  let at = 0;
  return clips.map((body) => {
    const placed = { ...body, at };
    at += body.end - body.start;
    return placed;
  });
}

/** A plan of one track, keyed `t`, with the clips back to back from the start. */
export function singleTrack(
  clips: readonly AudioClipBody[],
  options: { sampleRate?: number; channels?: number; metadata?: AudioMetadata } = {},
): AudioPlan {
  return {
    sampleRate: options.sampleRate ?? 8_000,
    channels: options.channels ?? 1,
    gainDb: 0,
    tracks: [trackOf("t", backToBack(clips))],
    metadata: options.metadata ?? EMPTY_METADATA,
  };
}
