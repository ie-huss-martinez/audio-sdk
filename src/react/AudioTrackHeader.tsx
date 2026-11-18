import { Button, MutedIcon, Slider, ToggleButton, useAnnounce } from "@hussmartinez/ui/react";
import { type ReactNode, useEffect, useRef } from "react";
import type { AudioTrack } from "../core/model/plan.js";
import type { AudioCommand } from "../core/operations/commands.js";
import { useAudioEditorContext } from "./context.js";
import { useDraft } from "./draft.js";
import { trackName } from "./names.js";
import { useAudioTools } from "./tools.js";

/** The gain slider's range, in decibels: the commands allow more, which the inspector sets. */
const GAIN = { min: -60, max: 12 } as const;

/**
 * A track's header (docs/adr/0006): its name, which opens the editor's
 * rename dialog, Mute and Solo, and its gain. `ui`'s lane renders it as a
 * toolbar that stays in view while the timeline scrolls: one Tab stop, with
 * ← and → between the controls. A gain drag is one undo step, committed when
 * it ends; each key press is one.
 */
export function AudioTrackHeader({
  track,
  index,
  rippling = false,
}: {
  readonly track: AudioTrack;
  readonly index: number;
  /** Whether deleting the selection would move this track's later clips, and not others'. */
  readonly rippling?: boolean;
}): ReactNode {
  const { session, messages, pendingFocus, setRenaming } = useAudioEditorContext();
  const { ariaKeyShortcuts } = useAudioTools();
  const announce = useAnnounce();
  const name = trackName(messages, track, index);
  const rename = useRef<HTMLButtonElement>(null);

  // After the track is added or moved, focus lands on its name (docs/adr/0006).
  useEffect(() => {
    if (pendingFocus.current !== track.key) return;
    pendingFocus.current = undefined;
    rename.current?.focus();
  });

  const execute = (command: AudioCommand) => {
    try {
      session.execute(command);
      return true;
    } catch {
      // A refused edit leaves the plan as it was, and the control shows it.
      return false;
    }
  };

  const [gain, setGain, commitGain] = useDraft(track.gainDb, (gainDb) =>
    execute({ type: "audio.setTrack", key: track.key, gainDb }),
  );

  return (
    <>
      <Button
        ref={rename}
        variant="quiet"
        size="small"
        className="hm-audio-editor-track-name"
        aria-label={messages.t("track.rename", { track: name })}
        onClick={() => setRenaming(track.key)}
      >
        <bdi>{name}</bdi>
      </Button>
      <ToggleButton
        variant="quiet"
        size="small"
        label={messages.t("track.mute")}
        icon={<MutedIcon />}
        aria-keyshortcuts={ariaKeyShortcuts("audio.mute")}
        pressed={track.muted}
        onPressedChange={(muted) => {
          if (execute({ type: "audio.setTrack", key: track.key, muted })) {
            announce(messages.t(muted ? "announce.muted" : "announce.unmuted", { track: name }));
          }
        }}
      />
      <ToggleButton
        variant="quiet"
        size="small"
        pressed={track.soloed}
        onPressedChange={(soloed) => {
          if (execute({ type: "audio.setTrack", key: track.key, soloed })) {
            announce(messages.t(soloed ? "announce.soloed" : "announce.unsoloed", { track: name }));
          }
        }}
      >
        {messages.t("track.solo")}
      </ToggleButton>
      <Slider
        className="hm-audio-editor-track-gain"
        label={messages.t("track.gain")}
        min={GAIN.min}
        max={GAIN.max}
        step={1}
        value={Math.min(GAIN.max, Math.max(GAIN.min, gain))}
        onValueChange={setGain}
        formatValue={(value) => messages.t("track.gainValue", { gain: value })}
        onPointerUp={commitGain}
        onKeyUp={commitGain}
        onBlur={commitGain}
      />
      {rippling ? (
        // In text, not by the lane's colour alone (docs/adr/0006).
        <span className="hm-audio-editor-track-ripple">{messages.t("track.ripple")}</span>
      ) : null}
    </>
  );
}
