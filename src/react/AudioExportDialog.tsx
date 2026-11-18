import { Button, Dialog, ProgressBar, SegmentedControl, useAnnounce } from "@hussmartinez/ui/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { wavFileSize } from "../adapters/wav/wav-layout.js";
import { isAudioError } from "../core/errors/audio-error.js";
import {
  type AudioMetadata,
  type AudioPlan,
  audibleTracks,
  planLength,
} from "../core/model/plan.js";
import { formatTimecode } from "../core/model/time.js";
import type { AudioRenderResult, AudioSampleFormat } from "../core/ports/audio-processor.js";
import { exportFileName } from "../features/export-name/export-name.js";
import { audioErrorText } from "../messages/text.js";
import { useAudioEditorContext, useAudioSession } from "./context.js";
import type { AudioEditorMessages } from "./editor-messages.js";
import { trackName } from "./names.js";
import { classes } from "./parts.js";
import { useAudioTools } from "./tools.js";

/**
 * Props of {@link AudioExportDialog}.
 *
 * @public
 */
export interface AudioExportDialogProps {
  /**
   * Takes the exported file instead of the dialog's download button: the
   * dialog closes once it's called. `result` says how loud the mix was, and
   * how many frames were clamped to full scale.
   */
  readonly onExport?: (blob: Blob, result: AudioRenderResult) => void;
  /**
   * The downloaded file's name, without its extension, such as
   * `"Interview"`. Without it, the recording's title is used, or else
   * `recording`. It's cleaned as the family cleans a file name (pdf-sdk ADR
   * 0009): the last path segment, without control or bidirectional
   * formatting characters or characters Windows refuses, and at most 128
   * characters. Then an audio extension is dropped, as the export adds its
   * own.
   */
  readonly fileName?: string;
  readonly className?: string;
}

type Phase =
  | { readonly kind: "choose" }
  | { readonly kind: "exporting"; readonly progress: number }
  | { readonly kind: "done"; readonly result: AudioRenderResult };

const FORMATS: readonly AudioSampleFormat[] = ["pcm16", "pcm24", "float32"];
const FIELDS: readonly (keyof AudioMetadata)[] = ["title", "artist", "album", "year", "comment"];

/** What the mix clipped by, rounded up to a tenth of a decibel, so lowering by it never clips. */
export function clippedBy(peakDb: number): number {
  return Math.ceil(peakDb * 10) / 10;
}

/** The summary's sentences about the tracks: which are left out, and why. */
function trackLines(messages: AudioEditorMessages, plan: AudioPlan): readonly string[] {
  const heard = new Set(audibleTracks(plan));
  const soloing = plan.tracks.some((track) => track.soloed);
  return plan.tracks.flatMap((track, index) => {
    if (track.clips.length === 0 || heard.has(track)) return [];
    const name = trackName(messages, track, index);
    return [
      track.muted
        ? messages.t("export.muted", { track: name })
        : soloing
          ? messages.t("export.silenced", { track: name })
          : messages.t("export.silent", { track: name }),
    ];
  });
}

/**
 * The export dialog (docs/adr/0005, docs/adr/0006). Export is irreversible,
 * so it shows a summary first: the length, the sample rate and channels,
 * which tracks will be heard and which a mute or a solo leaves out, the
 * metadata that will be written, and each format's size. Then a progress
 * bar that can stop the export, and a download button, which gets focus.
 * When the mix went over full scale, it says by how much, and offers to
 * lower the master gain by that and export again.
 *
 * It opens with the Export tool. Whatever closes it, such as Escape or
 * Done, stops its export and resets it, so it reopens fresh; a result that
 * arrives after that is dropped. Unmounting stops the export too. Inside an
 * {@link AudioEditorProvider}.
 *
 * @public
 */
export function AudioExportDialog(props: AudioExportDialogProps): ReactNode {
  const { onExport, fileName } = props;
  const { messages, dialog, setDialog } = useAudioEditorContext();
  const { session, snapshot } = useAudioSession();
  const tools = useAudioTools();
  const announce = useAnnounce();
  const [format, setFormat] = useState<AudioSampleFormat>("pcm16");
  const [phase, setPhase] = useState<Phase>({ kind: "choose" });
  const [error, setError] = useState<unknown>(null);
  const controller = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);
  const downloadButton = useRef<HTMLButtonElement>(null);

  const { plan } = snapshot;
  const length = plan ? planLength(plan) : 0;
  const open = dialog === "export" && plan !== undefined && length > 0;

  // Whatever closes the dialog ends its export and drops its choice and
  // result, so it reopens fresh. The controller is cleared before the
  // abort, so the export's own handlers know it isn't theirs any more.
  useEffect(() => {
    if (open) return;
    const running = controller.current;
    controller.current = null;
    running?.abort();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    setFormat("pcm16");
    setPhase((now) => (now.kind === "choose" ? now : { kind: "choose" }));
    setError(null);
    // The plan emptied under an open dialog: close it for good.
    if (dialog === "export") setDialog(undefined);
  }, [open, dialog, setDialog]);

  // Unmounting ends an export too, and frees a download's URL.
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  const done = phase.kind === "done";
  useEffect(() => {
    if (done) downloadButton.current?.focus();
  }, [done]);

  if (!plan) return null;

  const close = () => setDialog(undefined);

  const run = async () => {
    setError(null);
    const running = new AbortController();
    controller.current = running;
    setPhase({ kind: "exporting", progress: 0 });
    try {
      const result = await session.export({
        format: { container: "wav", sampleFormat: format },
        signal: running.signal,
        onProgress: (progress) =>
          setPhase((now) => (now.kind === "exporting" ? { ...now, progress } : now)),
      });
      // Closed while it ran: the result belongs to no one.
      if (controller.current !== running) return;
      controller.current = null;
      announce(messages.t("export.ready", { size: result.blob.size }));
      if (onExport) {
        onExport(result.blob, result);
        close();
        return;
      }
      setPhase({ kind: "done", result });
    } catch (reason) {
      // Closed while it ran: the reset dialog shows nothing of it.
      if (controller.current !== running) return;
      controller.current = null;
      setPhase({ kind: "choose" });
      if (isAudioError(reason, "ABORTED")) {
        announce(messages.t("export.cancelled"));
        return;
      }
      setError(reason);
    }
  };

  // The clipping report's one button (docs/adr/0006): the master gain goes
  // down by what the mix clipped by, as one undo step, and it exports again.
  const lowerAndRetry = (by: number) => {
    const edit = tools.context();
    if (edit.execute({ type: "audio.setMasterGain", gainDb: plan.gainDb - by })) {
      edit.announce({ key: "announce.refused" });
      return;
    }
    void run();
  };

  const stop = () => controller.current?.abort();

  const download = () => {
    if (phase.kind !== "done") return;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(phase.result.blob);
    const link = document.createElement("a");
    link.href = objectUrl.current;
    link.download = `${exportFileName(fileName, plan.metadata.title)}.wav`;
    link.click();
  };

  const rate = plan.sampleRate;
  const channels =
    plan.channels === 1
      ? messages.t("inspector.mono")
      : plan.channels === 2
        ? messages.t("inspector.stereo")
        : messages.t("inspector.channelCount", { count: plan.channels });
  const kept = FIELDS.filter((field) => plan.metadata[field] !== "");
  const list = new Intl.ListFormat(messages.locale, { type: "conjunction" });
  const leftOut = trackLines(messages, plan);
  const nothingHeard = audibleTracks(plan).every((track) => track.clips.length === 0);
  const exporting = phase.kind === "exporting";
  const size = (sampleFormat: AudioSampleFormat) =>
    wavFileSize({
      sampleRate: rate,
      channels: plan.channels,
      frames: length,
      sampleFormat,
      metadata: plan.metadata,
    });

  const footer =
    phase.kind === "done" ? (
      <>
        <Button variant="secondary" onClick={close}>
          {messages.t("export.done")}
        </Button>
        <Button ref={downloadButton} variant="primary" onClick={download}>
          {messages.t("export.download")}
        </Button>
      </>
    ) : exporting ? (
      <Button variant="secondary" onClick={stop}>
        {messages.t("export.stop")}
      </Button>
    ) : (
      <>
        <Button variant="secondary" onClick={close}>
          {messages.t("export.cancel")}
        </Button>
        <Button
          variant="primary"
          disabled={nothingHeard}
          focusableWhenDisabled
          onClick={() => void run()}
        >
          {messages.t("export.confirm")}
        </Button>
      </>
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={messages.t("export.title")}
      description={messages.t("export.description")}
      footer={footer}
      className={classes("hm-audio-export", props.className)}
    >
      {phase.kind === "done" ? (
        <>
          <p className="hm-audio-export-result">
            {messages.t("export.ready", { size: phase.result.blob.size })}
          </p>
          {/* The mix was clamped: say by how much, and what to do about it. */}
          {phase.result.clippedFrames > 0 ? (
            <div className="hm-audio-export-clipped" role="status">
              <p>
                {messages.t("export.clipped", {
                  db: clippedBy(phase.result.peakDb),
                  frames: phase.result.clippedFrames,
                })}
              </p>
              <Button
                variant="secondary"
                onClick={() => lowerAndRetry(clippedBy(phase.result.peakDb))}
              >
                {messages.t("export.lower", { db: clippedBy(phase.result.peakDb) })}
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <section className="hm-audio-export-summary" aria-label={messages.t("export.summary")}>
            <p>
              {messages.t("export.audio", {
                length: formatTimecode(length, rate),
                rate,
                channels,
              })}
            </p>
            {leftOut.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {nothingHeard ? <p>{messages.t("export.nothingHeard")}</p> : null}
            <p>
              {kept.length > 0
                ? messages.t("export.metadata", {
                    fields: list.format(
                      kept.map((field) => messages.t(`metadata.${field}` as "metadata.title")),
                    ),
                  })
                : messages.t("export.noMetadata")}
            </p>
            <p>{messages.t("export.private")}</p>
          </section>
          <SegmentedControl<AudioSampleFormat>
            label={messages.t("export.format")}
            size="small"
            value={format}
            onValueChange={(next) => {
              if (!exporting) setFormat(next);
            }}
            options={FORMATS.map((value) => ({
              value,
              label: messages.t(`export.formats.${value}`, { size: size(value) }),
            }))}
          />
          {exporting ? (
            <ProgressBar
              label={messages.t("export.progress")}
              value={Math.round(phase.progress * 100)}
              max={100}
            />
          ) : null}
          {error ? (
            <p className="hm-audio-export-error" role="alert">
              {/* A TypeError: no processor, as with a host's engine and none of its own. */}
              {error instanceof TypeError
                ? messages.t("export.unavailable")
                : audioErrorText(messages, error)}
            </p>
          ) : null}
        </>
      )}
    </Dialog>
  );
}
