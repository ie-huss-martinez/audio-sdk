import { Button, FileDropZone, ProgressBar } from "@hussmartinez/ui/react";
import type { ReactNode } from "react";
import { isAudioError } from "../core/errors/audio-error.js";
import { planLength } from "../core/model/plan.js";
import { formatTimecode } from "../core/model/time.js";
import { EditorTimeline } from "./AudioTimeline.js";
import { useAudioEditorContext, useAudioSession } from "./context.js";
import { classes, type PartClassNames } from "./parts.js";

/**
 * A hint for the file chooser and the drop zone. The SDK reads each file's
 * own bytes to know what it is (docs/adr/0001).
 */
export const ACCEPT =
  "audio/*,.wav,.wave,.aif,.aiff,.aifc,.flac,.mp3,.aac,.m4a,.mp4,.ogg,.oga,.opus,.webm,.mka";

/**
 * Props of {@link AudioStage}.
 *
 * @public
 */
export interface AudioStageProps {
  readonly className?: string;
}

/**
 * The editor's stage (docs/adr/0005): the empty state, a drop zone with a
 * button to choose a file, so dropping is never the only way; an open or an
 * insert in progress, with a Cancel button; a failed one, by its error's
 * text; and, once a recording is open, a line saying how many tracks and
 * how long, and the timeline. Inside an
 * {@link AudioEditorProvider}.
 *
 * @public
 */
export function AudioStage({ className }: AudioStageProps): ReactNode {
  return <Stage className={className} classNames={undefined} />;
}

/** The stage, with the editor's part classes. */
export function Stage({
  className,
  classNames,
}: {
  readonly className?: string | undefined;
  readonly classNames: PartClassNames | undefined;
}): ReactNode {
  const { messages, load, open, cancelLoad } = useAudioEditorContext();
  const { snapshot } = useAudioSession();
  const { plan, error } = snapshot;
  // A cancelled load is the person's own doing, not something to report.
  const failure =
    error && !isAudioError(error, "ABORTED") ? (
      <p className="hm-audio-editor-error" role="alert">
        {messages.error(error)}
      </p>
    ) : null;

  return (
    <div
      className={classes("hm-audio-editor-stage", classNames?.stage, className)}
      data-hm-empty={plan ? undefined : ""}
    >
      {load ? (
        <div className="hm-audio-editor-progress">
          <ProgressBar
            value={load.fraction}
            max={1}
            label={messages.t(load.kind === "open" ? "editor.opening" : "editor.inserting")}
          />
          <Button size="small" onClick={cancelLoad}>
            {messages.t("editor.cancel")}
          </Button>
        </div>
      ) : null}
      {plan ? (
        <>
          {failure}
          <p className="hm-audio-editor-summary">
            {messages.t("timeline.summary", {
              count: plan.tracks.length,
              duration: formatTimecode(planLength(plan), plan.sampleRate),
            })}
          </p>
          <EditorTimeline classNames={classNames} />
        </>
      ) : load ? null : (
        <FileDropZone
          className="hm-audio-editor-drop"
          accept={ACCEPT}
          hint={messages.t("editor.empty")}
          onFiles={([file]) => {
            // A failure is in the snapshot, which shows it here.
            if (file) open(file).catch(() => {});
          }}
        >
          {failure}
        </FileDropZone>
      )}
    </div>
  );
}
