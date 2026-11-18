import {
  Timeline,
  TimelineClips,
  type TimelineClipsHandle,
  TimelineLane,
  TimelineLayer,
  TimelinePlayhead,
} from "@hussmartinez/ui/react";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import {
  type AudioPlan,
  type AudioTrack,
  audibleTracks,
  clipEnd,
  planLength,
} from "../core/model/plan.js";
import { formatTimecode } from "../core/model/time.js";
import {
  canPlace,
  moveClips,
  moveClipsToTrack,
  nudgeFrames,
  trimClip,
  trimClipToPlayhead,
  trimLimits,
} from "../features/clips/clips.js";
import { AudioTrackHeader } from "./AudioTrackHeader.js";
import { AudioWaveform } from "./AudioWaveform.js";
import {
  useAudioEditorContext,
  useAudioOutput,
  useAudioPlayhead,
  useAudioSession,
} from "./context.js";
import type { AudioEditorMessages } from "./editor-messages.js";
import { trackName } from "./names.js";
import { classes, type PartClassNames } from "./parts.js";
import { useAudioTools } from "./tools.js";

/** A lane's accessible name: the track's, and whether it's heard. */
function laneLabel(
  messages: AudioEditorMessages,
  plan: AudioPlan,
  track: AudioTrack,
  name: string,
  audible: ReadonlySet<AudioTrack>,
): string {
  if (track.muted) return messages.t("timeline.lane.muted", { track: name });
  if (!audible.has(track) && plan.tracks.some((each) => each.soloed)) {
    return messages.t("timeline.lane.silenced", { track: name });
  }
  return messages.t("timeline.lane", { track: name });
}

/**
 * Props of {@link AudioTimeline}.
 *
 * @public
 */
export interface AudioTimelineProps {
  readonly className?: string;
}

/**
 * The editor's timeline (docs/adr/0006), on `ui`'s `Timeline`: one lane per
 * track, with its name in a header that stays in view, its waveform drawn
 * from the peaks, and its clips where they sit in time; the playhead as a
 * slider over all of them, in 10 ms steps and seconds with Page Up and Page
 * Down. Its zoom is the editor's, which the toolbar's zoom tools change.
 * Inside an {@link AudioEditorProvider}.
 *
 * @public
 */
export function AudioTimeline({ className }: AudioTimelineProps): ReactNode {
  return <EditorTimeline className={className} classNames={undefined} />;
}

/** The timeline, with the editor's part classes. */
export function EditorTimeline({
  className,
  classNames,
}: {
  readonly className?: string | undefined;
  readonly classNames: PartClassNames | undefined;
}): ReactNode {
  const context = useAudioEditorContext();
  const { messages, output, session, zoom, setMaxZoom, playhead, setCurrentTrack } = context;
  const { snapshot } = useAudioSession();
  const { snapshot: playback } = useAudioOutput();
  const position = useAudioPlayhead();
  const tools = useAudioTools();

  // Each lane's clip track, to move focus to a clip after it changes lanes
  // or is split (docs/adr/0005, docs/adr/0006).
  const clipTracks = useRef(new Map<string, TimelineClipsHandle>());
  const { pendingClipFocus } = context;
  useEffect(() => {
    const key = pendingClipFocus.current;
    if (key === undefined) return;
    for (const handle of clipTracks.current.values()) {
      if (handle.focusClip(key)) {
        pendingClipFocus.current = undefined;
        return;
      }
    }
  });

  // Scrolling and zooming redraw the waveforms, without rendering anything.
  const listeners = useRef(new Set<() => void>());
  const subscribeRange = useCallback((listener: () => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  const peaksOf = useCallback((source: string) => session.getPeaks(source), [session]);

  const { plan, sources } = snapshot;
  if (!plan) return null;
  const length = Math.max(1, planLength(plan));
  const rate = plan.sampleRate;
  const time = (frame: number) => formatTimecode(frame, rate);
  const audible = new Set(audibleTracks(plan));
  const names = new Map(sources.map((source) => [source.id, source.name]));
  const frames = new Map(sources.map((source) => [source.id, source.frames]));
  const sourceFrames = (source: string) => frames.get(source) ?? 0;
  const nudge = nudgeFrames(plan);

  return (
    <div className={classes("hm-audio-editor-timeline", classNames?.timeline, className)}>
      <Timeline
        label={messages.t("timeline.label")}
        length={length}
        zoom={zoom}
        onMaxZoomChange={setMaxZoom}
        onVisibleRangeChange={() => {
          for (const listener of listeners.current) listener();
        }}
      >
        <TimelinePlayhead
          ref={playhead}
          label={messages.t("timeline.playhead")}
          position={Math.min(position, length)}
          onPositionChange={(frame) => output.seek(frame)}
          step={Math.max(1, Math.round(rate / 100))}
          largeStep={rate}
          formatValue={time}
          following={playback.state === "playing"}
        />
        {plan.tracks.map((track, index) => {
          const name = trackName(messages, track, index);
          return (
            <TimelineLane
              key={track.key}
              id={track.key}
              label={laneLabel(messages, plan, track, name, audible)}
              header={<AudioTrackHeader track={track} index={index} />}
              data-hm-silent={audible.has(track) ? undefined : ""}
              // The track tools act on the track focus was last in, and the
              // clip tools on the clip: selection follows focus, by Tab too
              // (docs/adr/0005), where ui's clip track selects on arrows and clicks.
              onFocus={(event) => {
                setCurrentTrack(track.key);
                const key = (event.target as HTMLElement).dataset["hmKey"];
                if (key !== undefined && track.clips.some((clip) => clip.key === key)) {
                  context.setSelectedClip(key);
                }
              }}
            >
              <TimelineLayer className="hm-audio-editor-wave-layer" aria-hidden="true">
                <AudioWaveform track={track} peaksOf={peaksOf} subscribeRange={subscribeRange} />
              </TimelineLayer>
              <TimelineClips
                ref={(handle) => {
                  if (handle) clipTracks.current.set(track.key, handle);
                  else clipTracks.current.delete(track.key);
                }}
                label={messages.t("timeline.clips", { track: name })}
                clips={track.clips.map((clip, at) => {
                  const shown = names.get(clip.source);
                  const place = {
                    index: at + 1,
                    count: track.clips.length,
                    track: name,
                    start: time(clip.at),
                    end: time(clipEnd(clip)),
                  };
                  const label =
                    clip.gainDb === 0
                      ? shown
                        ? messages.t("timeline.clip.named", { ...place, name: shown })
                        : messages.t("timeline.clip", place)
                      : shown
                        ? messages.t("timeline.clip.named.gain", {
                            ...place,
                            name: shown,
                            gain: clip.gainDb,
                          })
                        : messages.t("timeline.clip.gain", { ...place, gain: clip.gainDb });
                  return {
                    key: clip.key,
                    at: clip.at,
                    length: clip.end - clip.start,
                    label,
                    ...(shown ? { content: <bdi>{shown}</bdi> } : {}),
                  };
                })}
                selectionMode="single"
                selectedKeys={
                  context.selectedClip &&
                  track.clips.some((clip) => clip.key === context.selectedClip)
                    ? [context.selectedClip]
                    : []
                }
                onSelectedKeysChange={(keys) => context.setSelectedClip(keys[0])}
                // A clip moves by its title strip: a press elsewhere on it
                // reaches the range layer beneath (docs/adr/0006).
                moveHandle="title"
                onMove={(keys, direction) => moveClips(tools.context(), keys, direction * nudge)}
                onMoveLane={(keys, direction) => moveClipsToTrack(tools.context(), keys, direction)}
                canDrop={(keys, drop) => canPlace(plan, keys, drop.by, drop.lane)}
                onDrop={(keys, drop) => {
                  const edit = tools.context();
                  if (moveClips(edit, keys, drop.by, drop.lane) && drop.lane !== undefined) {
                    const first = keys[0];
                    if (first !== undefined) edit.focusClip(first);
                  }
                }}
                trimStep={nudge}
                trimLimits={(key, edge) => trimLimits(plan, sourceFrames, key, edge)}
                onTrim={(key, edge, delta) => trimClip(tools.context(), key, edge, delta)}
                onTrimToPlayhead={(key, edge) => trimClipToPlayhead(tools.context(), key, edge)}
              />
            </TimelineLane>
          );
        })}
      </Timeline>
    </div>
  );
}
