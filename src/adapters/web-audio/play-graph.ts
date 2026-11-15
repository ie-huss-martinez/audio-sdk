import { type AudioPlan, clipLength, clipOffsets, planLength } from "../../core/model/plan.js";
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
 * - each clip is an `AudioBufferSourceNode` on its source, started at its
 *   offset, through a `GainNode` automated from `gainAt` (docs/adr/0001);
 * - every clip feeds one bus with the plan's channel count and Web Audio's
 *   `speakers` interpretation, so sources with other channel counts mix as
 *   export mixes them.
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
  bus.channelCount = plan.channels;
  bus.channelCountMode = "explicit";
  bus.channelInterpretation = "speakers";
  bus.connect(destination);

  const nodes: { source: AudioBufferSourceNode; gain: GainNode }[] = [];
  const offsets = clipOffsets(plan);
  const end = planLength(plan);
  for (const [index, clip] of plan.clips.entries()) {
    const offset = offsets[index] as number;
    const length = clipLength(clip);
    if (offset + length <= from || offset >= end) continue;
    const within = Math.max(0, from - offset);
    const when = at + Math.max(0, offset - from) / rate;
    const source = context.createBufferSource();
    source.buffer = buffer(clip.source);
    const gain = context.createGain();
    for (const event of gainEvents(clip, within, rate)) {
      if (event.kind === "set") gain.gain.setValueAtTime(event.value, when + event.time);
      else gain.gain.setValueCurveAtTime(event.values, when + event.time, event.duration);
    }
    source.connect(gain).connect(bus);
    source.start(when, (clip.start + within) / rate, (length - within) / rate);
    nodes.push({ source, gain });
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
      bus.disconnect();
    },
  };
}
