import { Field, NumberField, SegmentedControl, Slider, TextField } from "@hussmartinez/ui/react";
import { type ReactNode, useId } from "react";
import {
  type AudioClip,
  type AudioFadeCurve,
  type AudioMetadata,
  type AudioPlan,
  MAX_GAIN_DB,
  MIN_GAIN_DB,
  planLength,
} from "../core/model/plan.js";
import { formatTimecode } from "../core/model/time.js";
import { MAX_METADATA_LENGTH } from "../core/operations/checks.js";
import type { AudioCommand } from "../core/operations/commands.js";
import type { AudioSelection } from "../core/session/session.js";
import { findClip, moveClips, nudgeFrames } from "../features/clips/clips.js";
import { clipsInRange, setRangeGain } from "../features/range/edits.js";
import { useAudioEditorContext, useAudioSession } from "./context.js";
import { useDraft, useFollowing } from "./draft.js";
import type { AudioEditorMessages } from "./editor-messages.js";
import { trackName, tracksText } from "./names.js";
import { classes, type PartClassNames } from "./parts.js";
import { parseTimecode } from "./timecode.js";
import { useAudioTools } from "./tools.js";

/** The gain sliders' range, in decibels; the number fields beside them take the whole range. */
const SLIDER_GAIN = { min: -60, max: 12 } as const;

const METADATA_FIELDS: readonly (keyof AudioMetadata)[] = [
  "title",
  "artist",
  "album",
  "year",
  "comment",
];

/**
 * Props of {@link AudioInspector}.
 *
 * @public
 */
export interface AudioInspectorProps {
  readonly className?: string;
  /**
   * The level of the inspector's heading, from 2 to 6, so it fits the
   * host's outline. Defaults to 2.
   */
  readonly headingLevel?: AudioHeadingLevel;
}

/**
 * A heading level for the editor's headings, below the page's own `h1`.
 *
 * @public
 */
export type AudioHeadingLevel = 2 | 3 | 4 | 5 | 6;

/**
 * The editor's inspector (docs/adr/0005, docs/adr/0006): with a range
 * selected, its gain; otherwise the selected clip's start, gain and fades,
 * set exactly; with neither, the recording's facts, its master gain, its
 * channels and its metadata. Each
 * change is one undo step: a field's when it's committed, with Enter or by
 * leaving it, and a slider's when it's let go. Inside an
 * {@link AudioEditorProvider}.
 *
 * @public
 */
export function AudioInspector({ className, headingLevel }: AudioInspectorProps): ReactNode {
  return (
    <EditorInspector className={className} classNames={undefined} headingLevel={headingLevel} />
  );
}

/** The inspector, with the editor's part classes. */
export function EditorInspector({
  className,
  classNames,
  headingLevel = 2,
}: {
  readonly className?: string | undefined;
  readonly classNames: PartClassNames | undefined;
  readonly headingLevel?: AudioHeadingLevel | undefined;
}): ReactNode {
  const { messages, selectedClip } = useAudioEditorContext();
  const { snapshot } = useAudioSession();
  const tools = useAudioTools();
  const title = useId();
  const { plan } = snapshot;
  if (!plan) return null;
  const { selection } = snapshot;
  const placed = selectedClip === undefined ? undefined : findClip(plan, selectedClip);
  const Heading = `h${headingLevel}` as "h2";

  // Every edit here goes through the tools' context, so a refusal is said
  // as the toolbar's are.
  const run = (command: AudioCommand) => {
    const edit = tools.context();
    if (edit.execute(command)) edit.announce({ key: "announce.refused" });
  };

  return (
    <section
      className={classes("hm-audio-editor-inspector", classNames?.inspector, className)}
      aria-labelledby={title}
    >
      {selection ? (
        // A range comes first, as it does for Delete (docs/adr/0005).
        <>
          <Heading id={title} className="hm-audio-editor-inspector-title">
            {messages.t("inspector.selection")}
          </Heading>
          <SelectionFields
            plan={plan}
            selection={selection}
            messages={messages}
            setGain={(gainDb) => setRangeGain(tools.context(), gainDb)}
          />
        </>
      ) : placed ? (
        <>
          <Heading id={title} className="hm-audio-editor-inspector-title">
            {messages.t("inspector.clip", {
              track: trackName(messages, placed.track, plan.tracks.indexOf(placed.track)),
            })}
          </Heading>
          <ClipFields
            key={placed.clip.key}
            plan={plan}
            clip={placed.clip}
            messages={messages}
            run={run}
            move={(by) => moveClips(tools.context(), [placed.clip.key], by)}
          />
        </>
      ) : (
        <>
          <Heading id={title} className="hm-audio-editor-inspector-title">
            {messages.t("inspector.recording")}
          </Heading>
          <RecordingFields plan={plan} messages={messages} run={run} />
        </>
      )}
    </section>
  );
}

interface FieldsProps {
  readonly plan: AudioPlan;
  readonly messages: AudioEditorMessages;
  readonly run: (command: AudioCommand) => void;
}

/** A gain as a slider for the usual range and a field for any value, one undo step each change. */
function Gain({
  label,
  exactLabel,
  value,
  messages,
  onCommit,
}: {
  readonly label: string;
  readonly exactLabel: string;
  readonly value: number;
  readonly messages: AudioEditorMessages;
  readonly onCommit: (gainDb: number) => void;
}): ReactNode {
  const [live, setLive] = useFollowing(value);
  return (
    <div className="hm-audio-editor-inspector-gain">
      {/* A visible label, not only an accessible name (WCAG 3.3.2). */}
      <Field label={label}>
        <Slider
          min={SLIDER_GAIN.min}
          max={SLIDER_GAIN.max}
          step={1}
          value={Math.min(SLIDER_GAIN.max, Math.max(SLIDER_GAIN.min, live))}
          onValueChange={setLive}
          formatValue={(gain) => messages.t("track.gainValue", { gain })}
          // One undo step a gesture: a drag, or the keys pressed until let go.
          onValueCommit={(gainDb) => {
            if (gainDb !== value) onCommit(gainDb);
          }}
        />
      </Field>
      <Field label={exactLabel}>
        <NumberField
          value={value}
          min={MIN_GAIN_DB}
          max={MAX_GAIN_DB}
          step={0.5}
          largeStep={6}
          locale={messages.locale}
          onValueChange={(gainDb) => {
            if (gainDb !== value) onCommit(gainDb);
          }}
        />
      </Field>
    </div>
  );
}

/** A fade's length, in seconds, and its curve. */
function Fade({
  edge,
  clip,
  plan,
  messages,
  run,
}: FieldsProps & { readonly edge: "in" | "out"; readonly clip: AudioClip }): ReactNode {
  const rate = plan.sampleRate;
  const fade = edge === "in" ? clip.fadeIn : clip.fadeOut;
  const other = edge === "in" ? clip.fadeOut : clip.fadeIn;
  const set = (frames: number, curve: AudioFadeCurve) =>
    run({ type: "audio.setFade", key: clip.key, edge, frames, curve });
  return (
    <div className="hm-audio-editor-inspector-fade">
      <Field label={messages.t(edge === "in" ? "inspector.fadeIn" : "inspector.fadeOut")}>
        <NumberField
          value={fade.frames / rate}
          min={0}
          // The two fades together fit in the clip.
          max={(clip.end - clip.start - other.frames) / rate}
          step={0.01}
          largeStep={0.1}
          locale={messages.locale}
          onValueChange={(seconds) => {
            const frames = Math.round(seconds * rate);
            if (frames !== fade.frames) set(frames, fade.curve);
          }}
        />
      </Field>
      <SegmentedControl<AudioFadeCurve>
        size="small"
        label={messages.t(edge === "in" ? "inspector.fadeInCurve" : "inspector.fadeOutCurve")}
        value={fade.curve}
        onValueChange={(curve) => set(fade.frames, curve)}
        options={[
          { value: "linear", label: messages.t("inspector.curve.linear") },
          { value: "equalPower", label: messages.t("inspector.curve.equalPower") },
        ]}
      />
    </div>
  );
}

/** The selected clip's start, gain and fades. */
function ClipFields({
  plan,
  clip,
  messages,
  run,
  move,
}: FieldsProps & {
  readonly clip: AudioClip;
  readonly move: (by: number) => void;
}): ReactNode {
  const rate = plan.sampleRate;
  return (
    <>
      <Field label={messages.t("inspector.start")}>
        <NumberField
          value={clip.at}
          min={0}
          step={nudgeFrames(plan)}
          largeStep={rate}
          format={(frames) => formatTimecode(Math.max(0, Math.round(frames)), rate)}
          parse={(text) => parseTimecode(text, rate)}
          onValueChange={(at) => {
            if (at !== clip.at) move(at - clip.at);
          }}
        />
      </Field>
      <Gain
        label={messages.t("inspector.gain")}
        exactLabel={messages.t("inspector.gainExact")}
        value={clip.gainDb}
        messages={messages}
        onCommit={(gainDb) => run({ type: "audio.setGain", keys: [clip.key], gainDb })}
      />
      <Fade edge="in" clip={clip} plan={plan} messages={messages} run={run} />
      <Fade edge="out" clip={clip} plan={plan} messages={messages} run={run} />
    </>
  );
}

/**
 * The selected range, said as text, and its gain: setting it splits the
 * range's clips at its edges and sets what's between, as one undo step.
 * The field starts at the gain the range's clips share, or the first one's.
 */
function SelectionFields({
  plan,
  selection,
  messages,
  setGain,
}: {
  readonly plan: AudioPlan;
  readonly selection: AudioSelection;
  readonly messages: AudioEditorMessages;
  readonly setGain: (gainDb: number) => void;
}): ReactNode {
  const rate = plan.sampleRate;
  const clips = clipsInRange(plan, selection);
  const gain = clips[0]?.gainDb ?? 0;
  return (
    <>
      <p className="hm-audio-editor-inspector-range">
        {messages.t("timeline.selection", {
          start: formatTimecode(selection.start, rate),
          end: formatTimecode(selection.end, rate),
          tracks: tracksText(
            messages,
            plan,
            plan.tracks.filter((track) => selection.tracks.includes(track.key)),
          ),
        })}
      </p>
      <Field label={messages.t("inspector.selectionGain")}>
        <NumberField
          value={gain}
          min={MIN_GAIN_DB}
          max={MAX_GAIN_DB}
          step={0.5}
          largeStep={6}
          locale={messages.locale}
          disabled={clips.length === 0}
          onValueChange={(gainDb) => {
            if (clips.some((clip) => clip.gainDb !== gainDb)) setGain(gainDb);
          }}
        />
      </Field>
    </>
  );
}

/** The recording's facts, master gain, channels and metadata. */
function RecordingFields({ plan, messages, run }: FieldsProps): ReactNode {
  const channels = (count: number) =>
    count === 1
      ? messages.t("inspector.mono")
      : count === 2
        ? messages.t("inspector.stereo")
        : messages.t("inspector.channelCount", { count });
  const choices = [...new Set([1, 2, plan.channels])].sort((a, b) => a - b);
  return (
    <>
      <dl className="hm-audio-editor-facts">
        <dt>{messages.t("inspector.length")}</dt>
        <dd>{formatTimecode(planLength(plan), plan.sampleRate)}</dd>
        <dt>{messages.t("inspector.sampleRate")}</dt>
        <dd>{messages.t("inspector.sampleRateValue", { rate: plan.sampleRate })}</dd>
        <dt>{messages.t("inspector.tracks")}</dt>
        <dd>{messages.t("tracks.count", { count: plan.tracks.length })}</dd>
      </dl>
      <Gain
        label={messages.t("inspector.masterGain")}
        exactLabel={messages.t("inspector.masterGainExact")}
        value={plan.gainDb}
        messages={messages}
        onCommit={(gainDb) => run({ type: "audio.setMasterGain", gainDb })}
      />
      <SegmentedControl<string>
        size="small"
        label={messages.t("inspector.channels")}
        value={String(plan.channels)}
        onValueChange={(value) => run({ type: "audio.setChannels", channels: Number(value) })}
        options={choices.map((count) => ({ value: String(count), label: channels(count) }))}
      />
      {METADATA_FIELDS.map((field) => (
        <MetadataField
          key={field}
          field={field}
          value={plan.metadata[field]}
          messages={messages}
          run={run}
        />
      ))}
    </>
  );
}

/** One metadata field, committed with Enter or by leaving it. */
function MetadataField({
  field,
  value,
  messages,
  run,
}: {
  readonly field: keyof AudioMetadata;
  readonly value: string;
  readonly messages: AudioEditorMessages;
  readonly run: (command: AudioCommand) => void;
}): ReactNode {
  const [draft, setDraft, commit] = useDraft(value, (next) =>
    run({ type: "audio.setMetadata", field, value: next }),
  );
  return (
    <Field label={messages.t(`metadata.${field}` as "metadata.title")}>
      <TextField
        value={draft}
        maxLength={MAX_METADATA_LENGTH}
        onValueChange={setDraft}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          else if (event.key === "Escape" && draft !== value) {
            // Escape throws the typing away, as a number field's does.
            event.preventDefault();
            setDraft(value);
          }
        }}
      />
    </Field>
  );
}
