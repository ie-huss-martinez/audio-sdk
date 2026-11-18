import { dbToGain } from "../../core/model/envelope.js";
import {
  type AudioClip,
  type AudioPlan,
  type AudioTrack,
  audibleTracks,
  clipLength,
} from "../../core/model/plan.js";
import { gainEvents } from "./gain-automation.js";

/**
 * How long a change of a track's gain, mute or solo, or of the master gain,
 * takes to reach its new level during playback, in seconds: short enough to
 * feel immediate, and long enough not to click (docs/adr/0006).
 */
export const GAIN_RAMP = 0.005;

/** The nodes of a scheduled plan, to change its levels and to stop it. */
export interface ScheduledPlan {
  /**
   * Moves the tracks' gains and the master gain to a plan's, from context
   * time `at`, over {@link GAIN_RAMP}. The plan must have the same clips as
   * the one scheduled, as {@link sameClips} checks: nothing is rescheduled.
   */
  setLevels(plan: AudioPlan, at: number): void;
  /** Stops every clip at once, and disconnects the graph. */
  stop(): void;
}

/** The tracks that have clips, by key. */
function tracksWithClips(plan: AudioPlan): Map<string, readonly AudioClip[]> {
  const found = new Map<string, readonly AudioClip[]>();
  for (const track of plan.tracks) if (track.clips.length > 0) found.set(track.key, track.clips);
  return found;
}

/**
 * Whether two plans schedule the same audio: the same rate and channels,
 * and the same clips on the same tracks, compared by identity, as the
 * reducer keeps a track's clips when only its settings change. Then only
 * levels differ, the tracks' gain, mute and solo and the master gain, and
 * the order of the tracks, which isn't heard. An empty track isn't heard
 * either, so adding or removing one changes nothing here.
 */
export function sameClips(a: AudioPlan, b: AudioPlan): boolean {
  if (a.sampleRate !== b.sampleRate || a.channels !== b.channels) return false;
  const before = tracksWithClips(a);
  const after = tracksWithClips(b);
  if (before.size !== after.size) return false;
  for (const [key, clips] of before) if (after.get(key) !== clips) return false;
  return true;
}

/** Each track's level as a factor: its gain when it's audible, and silence when it isn't. */
function trackLevels(plan: AudioPlan): Map<string, number> {
  const audible = new Set<AudioTrack>(audibleTracks(plan));
  return new Map(
    plan.tracks.map((track) => [track.key, audible.has(track) ? dbToGain(track.gainDb) : 0]),
  );
}

/**
 * Schedules a plan from timeline frame `from`, with that frame playing at
 * context time `at` (docs/adr/0002):
 *
 * - each clip is an `AudioBufferSourceNode` on its source, started at its
 *   place on the timeline, through a `GainNode` automated from `gainAt`
 *   (docs/adr/0001);
 * - a track's clips feed the track's `GainNode`, at the track's gain, or at
 *   silence when the track is muted or left out by a solo. So a mute, a
 *   solo or a gain is one node's level, changed without rescheduling a
 *   clip (docs/adr/0006);
 * - the tracks feed one bus, at the master gain, with the plan's channel
 *   count and Web Audio's `speakers` interpretation, so sources with other
 *   channel counts mix as export mixes them.
 *
 * It works on any `BaseAudioContext`: the output plays through a realtime
 * one, and the tests render the same graph offline to compare with export.
 */
export function schedulePlan(
  context: BaseAudioContext,
  destination: AudioNode,
  plan: AudioPlan,
  buffer: (source: string) => AudioBuffer,
  from: number,
  at: number,
): ScheduledPlan {
  const rate = plan.sampleRate;
  const bus = context.createGain();
  bus.gain.value = dbToGain(plan.gainDb);
  bus.channelCount = plan.channels;
  bus.channelCountMode = "explicit";
  bus.channelInterpretation = "speakers";
  bus.connect(destination);

  const nodes: { source: AudioBufferSourceNode; gain: GainNode }[] = [];
  const tracks = new Map<string, GainNode>();
  // The level each node was last sent to, which a ramp starts from.
  const levels = trackLevels(plan);
  let master = dbToGain(plan.gainDb);
  for (const track of plan.tracks) {
    // A track with no clips has nothing to play, at any level.
    if (track.clips.length === 0) continue;
    const output = context.createGain();
    output.gain.value = levels.get(track.key) ?? 0;
    output.channelCount = plan.channels;
    output.channelCountMode = "explicit";
    output.channelInterpretation = "speakers";
    output.connect(bus);
    tracks.set(track.key, output);
    for (const clip of track.clips) {
      const length = clipLength(clip);
      if (clip.at + length <= from) continue;
      const within = Math.max(0, from - clip.at);
      const when = at + Math.max(0, clip.at - from) / rate;
      const source = context.createBufferSource();
      source.buffer = buffer(clip.source);
      const gain = context.createGain();
      for (const event of gainEvents(clip, within, rate)) {
        if (event.kind === "set") gain.gain.setValueAtTime(event.value, when + event.time);
        else gain.gain.setValueCurveAtTime(event.values, when + event.time, event.duration);
      }
      source.connect(gain).connect(output);
      source.start(when, (clip.start + within) / rate, (length - within) / rate);
      nodes.push({ source, gain });
    }
  }

  /** Sends a level to a new value, from where it was last sent, over the ramp. */
  const ramp = (param: AudioParam, from: number, to: number, time: number) => {
    if (from === to) return;
    param.setValueAtTime(from, time);
    param.linearRampToValueAtTime(to, time + GAIN_RAMP);
  };

  return {
    setLevels(next, time) {
      const targets = trackLevels(next);
      for (const [key, output] of tracks) {
        const target = targets.get(key) ?? 0;
        ramp(output.gain, levels.get(key) ?? 0, target, time);
        levels.set(key, target);
      }
      const target = dbToGain(next.gainDb);
      ramp(bus.gain, master, target, time);
      master = target;
    },
    stop() {
      for (const { source, gain } of nodes) {
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
        source.disconnect();
        gain.disconnect();
      }
      for (const output of tracks.values()) output.disconnect();
      bus.disconnect();
    },
  };
}
