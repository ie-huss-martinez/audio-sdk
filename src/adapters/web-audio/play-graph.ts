import { dbToGain } from "../../core/model/envelope.js";
import { type AudioPlan, audibleTracks, clipLength } from "../../core/model/plan.js";
import { gainEvents } from "./gain-automation.js";

/** The nodes of a scheduled plan, to stop it. */
export interface ScheduledPlan {
  /** Stops every clip at once, and disconnects the graph. */
  stop(): void;
}

/**
 * Schedules a plan from timeline frame `from`, with that frame playing at
 * context time `at` (docs/adr/0002):
 *
 * - each clip of an audible track is an `AudioBufferSourceNode` on its
 *   source, started at its place on the timeline, through a `GainNode`
 *   automated from `gainAt` (docs/adr/0001);
 * - a track's clips feed the track's `GainNode`, and the tracks feed one
 *   bus, at the master gain, with the plan's channel count and Web Audio's
 *   `speakers` interpretation, so sources with other channel counts mix as
 *   export mixes them (docs/adr/0006).
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
  const tracks: GainNode[] = [];
  for (const track of audibleTracks(plan)) {
    const output = context.createGain();
    output.gain.value = dbToGain(track.gainDb);
    output.channelCount = plan.channels;
    output.channelCountMode = "explicit";
    output.channelInterpretation = "speakers";
    output.connect(bus);
    tracks.push(output);
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

  return {
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
      for (const output of tracks) output.disconnect();
      bus.disconnect();
    },
  };
}
