import {
  applyCommands,
  checkFile,
  createHistory,
  createStore,
  type HistoryStep,
  withProcessingTime,
} from "@hussmartinez/sdk-core";
import { abortError, asAudioError, throwIfAborted } from "../errors/abort.js";
import { AudioError } from "../errors/audio-error.js";
import {
  type AudioFilePolicyOverrides,
  type AudioLimitName,
  audioLimits,
} from "../errors/audio-limits.js";
import { mixLength } from "../model/mix.js";
import {
  type AudioClip,
  type AudioPlan,
  type AudioTrack,
  EMPTY_METADATA,
  NO_FADE,
  planLength,
} from "../model/plan.js";
import {
  type AudioPeaks,
  type AudioSourceInfo,
  cleanSourceName,
  type DecodedAudio,
} from "../model/source.js";
import { framesToSeconds } from "../model/time.js";
import { type AudioCommand, createPlanReducer } from "../operations/commands.js";
import type { AudioEngine } from "../ports/audio-engine.js";
import type {
  AudioExportFormat,
  AudioProcessor,
  AudioRenderResult,
  AudioSampleFormat,
} from "../ports/audio-processor.js";
import type { AudioProgressOptions } from "../ports/options.js";

/** Bytes per decoded sample: sources are held as 32-bit floats (docs/adr/0004). */
const BYTES_PER_SAMPLE = 4;

/**
 * Something the user should know about the recordings open, though they
 * opened (docs/adr/0004). Show its text from `warnings.<limit>`, or from
 * `warnings.truncated`, in the message catalogue, with its fields as
 * parameters.
 *
 * - `limit`: a value at or above a limit's warning threshold, but within its
 *   maximum. `source` names the recording it's about, unless it's about the
 *   whole session, as `maxSessionSize` and `maxClips` are.
 * - `truncated`: an uncompressed recording holds fewer frames than its
 *   header declares, as after an interrupted recording or download. It
 *   opened with the frames it holds.
 *
 * @public
 */
export type AudioWarning =
  | {
      readonly type: "limit";
      readonly limit: AudioLimitName;
      readonly actual: number;
      readonly source?: string;
    }
  | {
      readonly type: "truncated";
      readonly source: string;
      /** The frames the recording holds. */
      readonly frames: number;
      /** The frames its header declares. */
      readonly declaredFrames: number;
    };

/**
 * A selected range of the timeline, on some tracks (docs/adr/0006): frames
 * from `start` inclusive to `end` exclusive, and the keys of the tracks it
 * covers, in plan order.
 *
 * @public
 */
export interface AudioSelection {
  readonly start: number;
  readonly end: number;
  /** The tracks the range covers, at least one. */
  readonly tracks: readonly string[];
}

/**
 * What the session is doing.
 *
 * - `empty`: no recording is open.
 * - `opening`: a recording is being opened, replacing any other.
 * - `ready`: a recording is open.
 * - `error`: no recording is open, because the last open failed; `error`
 *   says why. A failed open while a recording is open keeps it, with the
 *   status `ready` and `error` set.
 *
 * @public
 */
export type AudioSessionStatus = "empty" | "opening" | "ready" | "error";

/**
 * The session's state at one moment (docs/adr/0003). Snapshots are
 * immutable: every change makes a new one, so `useSyncExternalStore` and
 * other subscribers can compare them by identity. The playhead isn't here:
 * it belongs to `AudioOutput`, which moves it sixty times a second.
 *
 * @public
 */
export interface AudioSessionSnapshot {
  readonly status: AudioSessionStatus;
  /** The recording being edited, or `undefined` when none is open. */
  readonly plan: AudioPlan | undefined;
  /** The sources the session holds: those the plan uses, and those undo or redo can bring back. */
  readonly sources: readonly AudioSourceInfo[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /**
   * Whether undo steps were dropped since the recording opened, to make
   * room for an insert within `maxSessionSize`. Editors say so, because the
   * earliest edits can no longer be undone (ADR 0010).
   */
  readonly historyTrimmed: boolean;
  /** Whether a recording is being opened or inserted. */
  readonly busy: boolean;
  /** Why the last open or insert failed. Show its text by its code. */
  readonly error: AudioError | undefined;
  readonly warnings: readonly AudioWarning[];
  /**
   * The decoded bytes of every source the session holds, which the
   * `maxSessionSize` limit counts: frames × channels × 4.
   */
  readonly sessionBytes: number;
  /** The selected range of the timeline. View state: not undoable, and never in events. */
  readonly selection: AudioSelection | undefined;
}

/**
 * Anonymous usage events, for a host's analytics (docs/adr/0003). They
 * never contain file names, samples or metadata values. Durations are in
 * seconds, rounded to two significant figures, such as 3,500 for 3,456.7,
 * so that an exact length can't fingerprint a recording.
 *
 * @public
 */
export type AudioSessionEvent =
  | ({ readonly type: "recording_opened" | "recording_inserted" } & AudioRecordingFacts)
  | {
      readonly type: "recording_exported";
      readonly durationSeconds: number;
      readonly sampleRate: number;
      readonly channels: number;
      readonly sampleFormat: AudioSampleFormat;
    }
  | { readonly type: "recording_closed" }
  | { readonly type: "command"; readonly commands: readonly AudioCommand["type"][] }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | {
      readonly type: "failed";
      readonly operation: "open" | "insert" | "command" | "export";
      readonly code: string;
    };

/**
 * What an event says about a recording: its format and size, never its
 * name or contents.
 *
 * @public
 */
export interface AudioRecordingFacts {
  /** Rounded to two significant figures. */
  readonly durationSeconds: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly container: AudioSourceInfo["container"];
  readonly codec: AudioSourceInfo["codec"];
  readonly truncated: boolean;
}

/**
 * Options for {@link createAudioSession}.
 *
 * @public
 */
export interface AudioSessionOptions {
  /** Probes, decodes and builds waveform peaks, such as `createAudioEngine()`. */
  readonly engine: AudioEngine;
  /** Limits for untrusted files (docs/adr/0004). Unknown names throw. */
  readonly filePolicy?: AudioFilePolicyOverrides;
  /** Renders and encodes exports, such as `createAudioProcessor()`. Needed for `export()`. */
  readonly processor?: AudioProcessor;
  /** Receives anonymous usage events. Errors it throws are ignored. */
  readonly onEvent?: (event: AudioSessionEvent) => void;
}

/**
 * Options for {@link AudioSession.export}.
 *
 * @public
 */
export interface AudioSessionExportOptions extends AudioProgressOptions {
  /** The file to write. Defaults to 16-bit PCM WAV. */
  readonly format?: AudioExportFormat;
}

/**
 * Options for {@link AudioSession.insert}.
 *
 * @public
 */
export interface AudioOpenOptions extends AudioProgressOptions {
  /**
   * A name for the recording, to show people, such as its file's. Defaults
   * to the file's own name when it's a `File`. It's cleaned of control and
   * bidirectional formatting characters, cut to 255 code points, and kept
   * on the source in `snapshot.sources`, never in events, the plan or a
   * document.
   */
  readonly name?: string;
}

/**
 * Options for {@link AudioSession.insert}.
 *
 * @public
 */
export interface AudioInsertOptions extends AudioOpenOptions {
  /**
   * The key of the track the recording goes on, where it needs free space.
   * Without it, the recording gets a new track of its own, below the
   * others: laying one recording under another is the common case.
   */
  readonly track?: string;
  /** The timeline frame the recording starts on. Defaults to 0. */
  readonly at?: number;
}

/**
 * The recording being edited, as a framework-agnostic store (ADR 0008,
 * ADR 0029): a clip plan over decoded sources, edited with commands, with
 * undo and redo (docs/adr/0003). React binds to it with
 * `useSyncExternalStore`, and the element binds to the same store.
 *
 * @public
 */
export interface AudioSession {
  /** The current snapshot, the same object until something changes. */
  getSnapshot(): AudioSessionSnapshot;
  /** Calls the listener after every change. Returns a function that unsubscribes. */
  subscribe(listener: () => void): () => void;
  /**
   * Opens a recording, replacing the current one and its history once it
   * has opened. The file is checked against the file policy before it's
   * read, and its probe before it's decoded. Rejects with an `AudioError`,
   * which the snapshot also holds; the current recording, if any, stays
   * open.
   */
  open(file: Blob, options?: AudioOpenOptions): Promise<void>;
  /**
   * Adds another recording, as one undoable step: on a new track of its
   * own, below the others, or on the track `options.track` names, where it
   * needs free space. It starts at `options.at`, or at the start. A
   * recording at another sample rate is converted to the session's, and its
   * source says so in `resampledFrom`; one with more channels than the plan
   * raises the plan's channel count to its own, in the same step. If the
   * sources held would then exceed `maxSessionSize`, the session first drops
   * history steps, in sdk-core's `dropOrder`, as far as needed to release
   * sources only they refer to, and sets `historyTrimmed`. If even that
   * isn't enough, it rejects with `SESSION_TOO_LARGE` and changes nothing.
   */
  insert(file: Blob, options?: AudioInsertOptions): Promise<void>;
  /**
   * Runs one command, or several as one undoable step. A command that
   * doesn't apply throws `AudioError` with `INVALID_COMMAND`, and one that
   * would exceed a limit throws its code: `TOO_MANY_CLIPS` for `maxClips`,
   * `TOO_MANY_TRACKS` for `maxTracks`, and `DURATION_TOO_LONG` when the plan
   * would become longer than `maxDuration`. Any of them changes
   * nothing. The commands are copied, so changing them afterwards has no
   * effect.
   */
  execute(commands: AudioCommand | readonly AudioCommand[]): void;
  /**
   * Runs `fn`, and records the commands it executes as one undoable step,
   * for gestures such as dragging a trim handle.
   */
  group<T>(fn: () => T): T;
  /**
   * A key no track or clip has, in the plan or the history, for commands
   * that create them, such as `newKey` in `audio.splitClip` or `key` in
   * `audio.addTrack`.
   */
  createKey(): string;
  undo(): void;
  redo(): void;
  /**
   * Selects a range of the timeline on the tracks named, or on every track
   * without `tracks`, clamped to the plan, or clears the selection with
   * `undefined`. An empty range clears it too, as does one that names no
   * track the plan has.
   */
  select(
    range:
      | { readonly start: number; readonly end: number; readonly tracks?: readonly string[] }
      | undefined,
  ): void;
  /** A source's waveform overview, or `undefined` for a source the session doesn't hold. */
  getPeaks(source: string): AudioPeaks | undefined;
  /**
   * A source's decoded audio, for playback, or `undefined` for a source the
   * session doesn't hold. Don't modify it: sources never change.
   */
  getAudio(source: string): DecodedAudio | undefined;
  /**
   * Mixes and encodes the plan's audible tracks as they are now, with the
   * session's `processor`, under `maxProcessingTime`. It returns the file
   * with the mix's peak and the frames that clipped, and never downloads
   * it: the host decides what to do with it. Edits made while it runs don't
   * change it. Rejects with `INVALID_COMMAND` and the reason `no-recording`,
   * `empty-plan` or `nothing-audible` when there's nothing to export, and
   * throws `TypeError` when the session has no processor.
   */
  export(options?: AudioSessionExportOptions): Promise<AudioRenderResult>;
  /** Closes the recording and releases its sources. */
  close(): Promise<void>;
}

interface Source {
  readonly info: AudioSourceInfo;
  readonly audio: DecodedAudio;
  readonly peaks: AudioPeaks;
  readonly bytes: number;
  readonly warnings: readonly AudioWarning[];
}

/** The clips a command or its inverse carries, which keep their sources alive. */
function clipsOf(command: AudioCommand): readonly AudioClip[] {
  switch (command.type) {
    case "audio.insertClips":
    case "audio.updateClips":
      return command.clips;
    case "audio.restoreClips":
      return command.entries.map((entry) => entry.clip);
    case "audio.replaceClips":
      return command.edits.flatMap((edit) => edit.clips);
    case "audio.restoreTracks":
      return command.entries.flatMap((entry) => entry.track.clips);
    default:
      return [];
  }
}

/**
 * A duration as events report it: two significant figures, so it describes
 * a recording's length without identifying the recording.
 */
function coarseSeconds(seconds: number): number {
  return seconds > 0 ? Number(seconds.toPrecision(2)) : 0;
}

/** Every key a command creates or carries: its clips', its tracks' and its new parts'. */
function keysOf(command: AudioCommand): string[] {
  const keys = clipsOf(command).map((clip) => clip.key);
  if ("newKey" in command && typeof command.newKey === "string") keys.push(command.newKey);
  if ("newKeys" in command && command.newKeys) keys.push(...Object.values(command.newKeys));
  if (command.type === "audio.addTrack" && typeof command.key === "string") keys.push(command.key);
  if (command.type === "audio.restoreTracks") {
    keys.push(...command.entries.map((entry) => entry.track.key));
  }
  return keys;
}

/** The edits that add or remove time, and so move what's after them. */
const TIME_EDITS: ReadonlySet<AudioCommand["type"]> = new Set([
  "audio.deleteRange",
  "audio.keepRange",
  "audio.insertTime",
]);

/** Whether two values of plain data are equal: the same fields, holding equal values. */
function equalData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(
    (key) =>
      Object.hasOwn(b, key) &&
      equalData((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/** Every clip of a plan, track by track. */
function clipsIn(plan: AudioPlan | undefined): AudioClip[] {
  return plan ? plan.tracks.flatMap((track) => track.clips) : [];
}

/** A clip that plays the whole of a source, from a timeline frame. */
function wholeClip(key: string, source: AudioSourceInfo, at: number): AudioClip {
  return {
    key,
    at,
    source: source.id,
    start: 0,
    end: source.frames,
    gainDb: 0,
    fadeIn: NO_FADE,
    fadeOut: NO_FADE,
  };
}

/**
 * Creates an {@link AudioSession}. Pass the engine to use; the headless core
 * doesn't choose one.
 *
 * @example
 * ```ts
 * const session = createAudioSession({ engine: createAudioEngine() });
 * await session.open(file);
 * const [clip] = session.getSnapshot().plan?.tracks[0]?.clips ?? [];
 * session.execute({ type: "audio.setGain", keys: [clip.key], gainDb: -3 });
 * session.undo();
 * ```
 *
 * @public
 */
export function createAudioSession(options: AudioSessionOptions): AudioSession {
  const { engine } = options;
  const policy = audioLimits.resolve(options.filePolicy);
  const history = createHistory<AudioCommand>();
  const sources = new Map<string, Source>();
  const reducer = createPlanReducer((id) => sources.get(id)?.info.frames);
  let plan: AudioPlan | undefined;
  let status: AudioSessionStatus = "empty";
  let error: AudioError | undefined;
  let busy = 0;
  let selection: AudioSelection | undefined;
  let nextKey = 0;
  let nextSource = 0;
  /** The loads in progress, which a newer open or a close cancels. */
  const loading = new Set<AbortController>();
  const cancelLoads = (message: string) => {
    for (const controller of loading) controller.abort(new AudioError("ABORTED", message));
  };
  /**
   * Counts opens and closes. A load that finishes after another open or a
   * close changes nothing, and reports nothing: that one reports.
   */
  let generation = 0;
  const superseded = (since: number) =>
    since !== generation
      ? new AudioError("ABORTED", "The recording was closed or replaced.")
      : undefined;

  const heldBytes = (): number => {
    let total = 0;
    for (const source of sources.values()) total += source.bytes;
    return total;
  };

  /** The sources the plan and the given history steps refer to. */
  function referenced(steps: readonly HistoryStep<AudioCommand>[]): Set<string> {
    const ids = new Set(clipsIn(plan).map((clip) => clip.source));
    for (const { commands, inverses } of steps) {
      for (const command of [...commands, ...inverses]) {
        for (const clip of clipsOf(command)) ids.add(clip.source);
      }
    }
    return ids;
  }

  /** Releases the sources nothing refers to any more. */
  function collect(): void {
    const keep = referenced(history.steps);
    for (const id of sources.keys()) if (!keep.has(id)) sources.delete(id);
  }

  /**
   * How many history steps must be dropped, in drop order, for the held
   * sources plus `extra` bytes to fit `maxSessionSize`, or `undefined` if
   * dropping every step isn't enough.
   */
  function stepsToDrop(extra: number): number | undefined {
    const { maximum } = policy.limits.maxSessionSize;
    const order = history.dropOrder;
    for (let count = 0; count <= order.length; count += 1) {
      const kept = new Set(order.slice(count));
      const ids = referenced(history.steps.filter((entry) => kept.has(entry)));
      let total = extra;
      for (const id of ids) total += sources.get(id)?.bytes ?? 0;
      if (total <= maximum) return count;
    }
    return undefined;
  }

  /** The sources' own warnings, and the session's, which follow every change. */
  function sessionWarnings(): AudioWarning[] {
    const found = [...sources.values()].flatMap((source) => source.warnings);
    const bytes = heldBytes();
    if (bytes > 0 && bytes >= policy.limits.maxSessionSize.warning) {
      found.push({ type: "limit", limit: "maxSessionSize", actual: bytes });
    }
    const clips = clipsIn(plan).length;
    if (clips > 0 && clips >= policy.limits.maxClips.warning) {
      found.push({ type: "limit", limit: "maxClips", actual: clips });
    }
    const tracks = plan?.tracks.length ?? 0;
    if (tracks > 0 && tracks >= policy.limits.maxTracks.warning) {
      found.push({ type: "limit", limit: "maxTracks", actual: tracks });
    }
    return found;
  }

  function makeSnapshot(): AudioSessionSnapshot {
    return Object.freeze({
      status,
      plan,
      sources: Object.freeze([...sources.values()].map((source) => source.info)),
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      historyTrimmed: history.trimmed,
      busy: busy > 0,
      error,
      warnings: Object.freeze(sessionWarnings()),
      sessionBytes: heldBytes(),
      selection,
    });
  }

  const store = createStore<AudioSessionSnapshot>(makeSnapshot());

  function changed(): void {
    // The selection follows the plan: it can't reach past its end, or
    // cover a track that's gone.
    if (selection) {
      const end = Math.min(selection.end, plan ? planLength(plan) : 0);
      const tracks = (plan?.tracks ?? [])
        .map((track) => track.key)
        .filter((key) => selection?.tracks.includes(key));
      if (selection.start >= end || tracks.length === 0) selection = undefined;
      else if (end !== selection.end || tracks.length !== selection.tracks.length) {
        selection = Object.freeze({ start: selection.start, end, tracks: Object.freeze(tracks) });
      }
    }
    store.set(makeSnapshot());
  }

  function emit(event: AudioSessionEvent): void {
    try {
      options.onEvent?.(event);
    } catch {
      // A host's analytics must never break editing.
    }
  }

  function facts(source: Source): AudioRecordingFacts {
    const { info } = source;
    return {
      durationSeconds: coarseSeconds(framesToSeconds(info.frames, info.sampleRate)),
      sampleRate: info.sampleRate,
      channels: info.channels,
      container: info.container,
      codec: info.codec,
      truncated: source.warnings.some((warning) => warning.type === "truncated"),
    };
  }

  /**
   * Checks, probes, decodes and builds the peaks of one file, without
   * registering it. Every limit but the session's is checked here, and all
   * but the session size before decoding (docs/adr/0004).
   */
  async function load(
    file: Blob,
    signal: AbortSignal,
    onProgress: ((fraction: number) => void) | undefined,
    /** The session's rate, for an insert: a file at another rate is converted to it. */
    rate: number | undefined,
    /** The host's name for it, or the file's. */
    givenName: string | undefined,
  ): Promise<Source> {
    if (!(file instanceof Blob)) throw new TypeError("A recording must be a Blob or a File.");
    const name = cleanSourceName(
      givenName ?? (typeof File === "function" && file instanceof File ? file.name : undefined),
    );
    nextSource += 1;
    const id = `s${nextSource}`;
    const warnings: AudioWarning[] = [];
    const warnAt = (limit: AudioLimitName, actual: number) => {
      if (policy.check(limit, actual) === "warning") {
        warnings.push({ type: "limit", limit, actual, source: id });
      }
    };
    // The file size, before anything is read (ADR 0020).
    if (checkFile(policy, file) === "warning") {
      warnings.push({ type: "limit", limit: "maxFileSize", actual: file.size, source: id });
    }
    const probe = await withProcessingTime(
      policy,
      (limited) => engine.probe(file, { signal: limited }),
      { signal },
    );
    // The probe's bound and channels are maxima, so these checks hold for
    // whatever the decoder returns.
    warnAt("maxChannels", probe.channels);
    warnAt("maxSampleRate", probe.sampleRate);
    warnAt("maxDuration", Math.ceil((probe.frameBound * 1_000) / probe.sampleRate));
    warnAt("maxDecodedSize", probe.frameBound * probe.channels * BYTES_PER_SAMPLE);
    // A file at another rate is decoded at its own, then converted, so both
    // sizes are checked before anything is decoded (docs/adr/0004). The
    // bound scales with the rate, as the frames do.
    const sampleRate = rate ?? probe.sampleRate;
    const converts = sampleRate !== probe.sampleRate;
    const frameBound = Math.ceil((probe.frameBound * sampleRate) / probe.sampleRate);
    if (converts) warnAt("maxDecodedSize", frameBound * probe.channels * BYTES_PER_SAMPLE);
    const audio = await withProcessingTime(
      policy,
      (limited) =>
        engine.decode(file, probe, {
          signal: limited,
          ...(onProgress ? { onProgress } : {}),
          ...(converts ? { sampleRate } : {}),
        }),
      { signal },
    );
    // The source is what the decoder returned, capped at the bound, with the
    // decoder's own channel count: mono AAC probes as two channels
    // (docs/adr/0004).
    const frames = Math.min(audio.length, frameBound);
    const channels = audio.numberOfChannels;
    if (audio.sampleRate !== sampleRate || channels < 1 || channels > probe.channels) {
      throw new AudioError("INVALID_AUDIO", "The decoder's output doesn't match the probe.", {
        details: { container: probe.container, codec: probe.codec },
      });
    }
    if (frames < 1) {
      throw new AudioError("DECODE_FAILED", "The recording decoded to no audio.", {
        details: { codec: probe.codec },
      });
    }
    const peaks = await withProcessingTime(
      policy,
      (limited) => engine.peaks(audio, { signal: limited }),
      { signal },
    );
    throwIfAborted(signal);
    if (probe.declaredFrames !== undefined && probe.declaredFrames > frames) {
      warnings.push({
        type: "truncated",
        source: id,
        frames,
        declaredFrames: probe.declaredFrames,
      });
    }
    return {
      info: Object.freeze({
        id,
        sampleRate: audio.sampleRate,
        channels,
        frames,
        container: probe.container,
        codec: probe.codec,
        ...(converts ? { resampledFrom: probe.sampleRate } : {}),
        ...(name === undefined ? {} : { name }),
      }),
      audio,
      peaks,
      bytes: frames * channels * BYTES_PER_SAMPLE,
      warnings: Object.freeze(warnings),
    };
  }

  /** Runs a load, marking the session busy, and cancelling it if a newer open starts. */
  async function track<Value>(
    signal: AbortSignal | undefined,
    replaces: boolean,
    run: (signal: AbortSignal) => Promise<Value>,
  ): Promise<Value> {
    if (replaces) cancelLoads("A newer recording replaced this one.");
    const controller = new AbortController();
    loading.add(controller);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    busy += 1;
    changed();
    try {
      return await run(combined);
    } finally {
      busy -= 1;
      loading.delete(controller);
      changed();
    }
  }

  /**
   * Applies commands to the plan, checking `maxClips`, `maxTracks` and the
   * plan's length against `maxDuration`, without committing anything.
   */
  function applyChecked(
    current: AudioPlan,
    commands: readonly AudioCommand[],
  ): { state: AudioPlan; inverses: AudioCommand[] } {
    const result = applyCommands(reducer, current, commands);
    const next = result.state;
    // Each limit is checked when the plan grows past where it was, so a
    // plan already over a lowered limit can still be edited and shrunk.
    const clips = clipsIn(next).length;
    if (clips > clipsIn(current).length) policy.check("maxClips", clips);
    if (next.tracks.length > current.tracks.length) {
      policy.check("maxTracks", next.tracks.length);
    }
    // Positions are free, so a clip can be placed hours in, which no
    // file's limit catches: the plan's own length has one (docs/adr/0006).
    const length = planLength(next);
    if (length > planLength(current)) {
      policy.check("maxDuration", Math.ceil((length * 1_000) / next.sampleRate));
    }
    return result;
  }

  function commit(
    result: { state: AudioPlan; inverses: AudioCommand[] },
    commands: AudioCommand[],
  ) {
    plan = result.state;
    history.push({ commands, inverses: result.inverses });
    // A new step drops the redo steps, and the sources only they held.
    collect();
  }

  function newKey(also: ReadonlySet<string> = new Set()): string {
    const used = new Set(clipsIn(plan).map((clip) => clip.key));
    for (const key of also) used.add(key);
    for (const track of plan?.tracks ?? []) used.add(track.key);
    for (const { commands, inverses } of history.steps) {
      for (const command of [...commands, ...inverses])
        for (const key of keysOf(command)) used.add(key);
    }
    let key: string;
    do {
      nextKey += 1;
      key = `c${nextKey}`;
    } while (used.has(key));
    return key;
  }

  /**
   * Gives commands the keys they need and don't have (docs/adr/0006, point 2
   * of #54): a split's new part, a new track, and the parts a time edit
   * leaves after a cut, one for every track it names, which the reducer
   * ignores where a track doesn't need it. The history then records the
   * keys, so undo and redo stay exact, and the reducer stays pure.
   */
  function fillKeys(commands: AudioCommand[]): void {
    const taken = new Set(commands.flatMap(keysOf));
    const fresh = () => {
      const key = newKey(taken);
      taken.add(key);
      return key;
    };
    commands.forEach((command, index) => {
      if (command.type === "audio.splitClip" && command.newKey === undefined) {
        commands[index] = { ...command, newKey: fresh() };
      } else if (command.type === "audio.addTrack" && command.key === undefined) {
        commands[index] = { ...command, key: fresh() };
      } else if (
        (command.type === "audio.deleteRange" || command.type === "audio.insertTime") &&
        Array.isArray(command.tracks)
      ) {
        const given = command.newKeys ?? {};
        const missing = command.tracks.filter(
          (track) => typeof track === "string" && !Object.hasOwn(given, track),
        );
        if (missing.length === 0) return;
        const newKeys: Record<string, string> = { ...given };
        for (const track of missing) {
          // An own field, even for a track keyed `__proto__`.
          Object.defineProperty(newKeys, track, {
            value: fresh(),
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
        commands[index] = { ...command, newKeys };
      }
    });
  }

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,

    async open(file, callOptions = {}) {
      generation += 1;
      const started = generation;
      status = "opening";
      error = undefined;
      try {
        const source = await track(callOptions.signal, true, (signal) =>
          load(file, signal, callOptions.onProgress, undefined, callOptions.name),
        );
        const replaced = superseded(started);
        if (replaced) throw replaced;
        // The open recording is released once this one opens, so this one
        // must fit on its own.
        policy.check("maxSessionSize", source.bytes);
        sources.clear();
        history.clear();
        sources.set(source.info.id, source);
        // No plan yet, so the two keys only have to differ from each other.
        plan = undefined;
        const first: AudioTrack = {
          key: newKey(),
          name: "",
          gainDb: 0,
          muted: false,
          soloed: false,
          clips: [wholeClip(newKey(), source.info, 0)],
        };
        plan = {
          sampleRate: source.info.sampleRate,
          channels: source.info.channels,
          gainDb: 0,
          tracks: [first],
          metadata: EMPTY_METADATA,
        };
        selection = undefined;
        status = "ready";
        changed();
        emit({ type: "recording_opened", ...facts(source) });
      } catch (reason) {
        const failure = asAudioError(reason, "The recording couldn't be opened.");
        // A newer open replaced this one, or a close cancelled it; that
        // reports its own outcome.
        if (started !== generation) throw failure;
        // A failed open keeps the recording that was already open, and its
        // history, so a bad file never costs the user their work.
        status = plan ? "ready" : "error";
        error = failure;
        changed();
        emit({ type: "failed", operation: "open", code: failure.code });
        throw failure;
      }
    },

    async insert(file, insertOptions = {}) {
      if (!plan || status !== "ready") {
        throw new AudioError("INVALID_COMMAND", "Open a recording before inserting another.", {
          details: { reason: "no-recording" },
        });
      }
      const started = generation;
      error = undefined;
      try {
        const source = await track(insertOptions.signal, false, (signal) => {
          policy.check("maxFiles", sources.size + 1);
          return load(file, signal, insertOptions.onProgress, plan?.sampleRate, insertOptions.name);
        });
        const replaced = superseded(started);
        if (replaced) throw replaced;
        const current = plan as AudioPlan;
        // Everything that can fail happens before anything changes.
        const drop = stepsToDrop(source.bytes);
        if (drop === undefined) throw policy.error("maxSessionSize", heldBytes() + source.bytes);
        const clip = wholeClip(newKey(), source.info, insertOptions.at ?? 0);
        const commands: AudioCommand[] = [];
        // A wider recording widens the plan, so a mono voice opened first
        // doesn't fold stereo music to mono (docs/adr/0006). Never narrower.
        if (source.info.channels > current.channels) {
          commands.push({ type: "audio.setChannels", channels: source.info.channels });
        }
        let target = insertOptions.track;
        if (target === undefined) {
          target = newKey();
          commands.push({ type: "audio.addTrack", key: target, index: current.tracks.length });
        }
        commands.push({ type: "audio.insertClips", track: target, clips: [clip] });
        sources.set(source.info.id, source);
        let result: ReturnType<typeof applyChecked>;
        try {
          result = applyChecked(current, commands);
        } catch (reason) {
          sources.delete(source.info.id);
          throw reason;
        }
        history.drop(drop);
        commit(result, commands);
        changed();
        emit({ type: "recording_inserted", ...facts(source) });
      } catch (reason) {
        const failure = asAudioError(reason, "The recording couldn't be inserted.");
        if (started !== generation) throw failure;
        error = failure;
        changed();
        emit({ type: "failed", operation: "insert", code: failure.code });
        throw failure;
      }
    },

    execute(commands) {
      const list: AudioCommand[] = Array.isArray(commands)
        ? [...(commands as readonly AudioCommand[])]
        : [commands as AudioCommand];
      if (list.length === 0) return;
      try {
        if (!plan) {
          throw new AudioError("INVALID_COMMAND", "Open a recording before editing it.", {
            details: { reason: "no-recording" },
          });
        }
        let copies: AudioCommand[];
        try {
          // The history keeps its own copies, which also proves they're
          // plain, serialisable data (ADR 0010).
          copies = structuredClone(list);
        } catch (reason) {
          throw new AudioError("INVALID_COMMAND", "Commands must be plain data.", {
            cause: reason,
            details: { reason: "not-plain-data" },
          });
        }
        fillKeys(copies);
        const result = applyChecked(plan, copies);
        // A command that changes nothing, such as a gain that's already set,
        // succeeds without an undo step (point 4 of #54).
        if (equalData(result.state, plan)) return;
        commit(result, copies);
        // A time edit moves what's after it, so a selected range no longer
        // covers what was selected. Other edits keep it (point 5 of #54).
        if (copies.some((command) => TIME_EDITS.has(command.type))) selection = undefined;
      } catch (reason) {
        const failure = asAudioError(reason);
        emit({ type: "failed", operation: "command", code: failure.code });
        throw failure;
      }
      changed();
      emit({ type: "command", commands: list.map((command) => command.type) });
    },

    group: (fn) => history.group(fn),

    createKey: newKey,

    undo() {
      const current = plan;
      const entry = current && history.undo();
      if (!current || !entry) return;
      try {
        plan = applyCommands(reducer, current, entry.inverses).state;
      } catch (reason) {
        history.restore("undo");
        throw reason;
      }
      changed();
      emit({ type: "undo" });
    },

    redo() {
      const current = plan;
      const entry = current && history.redo();
      if (!current || !entry) return;
      try {
        plan = applyCommands(reducer, current, entry.commands).state;
      } catch (reason) {
        history.restore("redo");
        throw reason;
      }
      changed();
      emit({ type: "redo" });
    },

    select(range) {
      let next: AudioSelection | undefined;
      if (range) {
        const { start, end } = range;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
          throw new RangeError("A selection is a range of whole frames.");
        }
        const length = plan ? planLength(plan) : 0;
        const from = Math.max(0, Math.min(start, end, length));
        const to = Math.min(length, Math.max(start, end, 0));
        // The plan's tracks the range names, in plan order; every track by default.
        const tracks = (plan?.tracks ?? [])
          .map((track) => track.key)
          .filter((key) => range.tracks === undefined || range.tracks.includes(key));
        if (from < to && tracks.length > 0) {
          next = Object.freeze({ start: from, end: to, tracks: Object.freeze(tracks) });
        }
      }
      const same =
        next?.start === selection?.start &&
        next?.end === selection?.end &&
        next?.tracks.join("\n") === selection?.tracks.join("\n");
      if (same) return;
      selection = next;
      changed();
    },

    getPeaks: (id) => sources.get(id)?.peaks,

    getAudio: (id) => sources.get(id)?.audio,

    async export(exportOptions = {}) {
      const current = plan;
      const format: AudioExportFormat = exportOptions.format ?? { container: "wav" };
      try {
        if (!current) {
          throw new AudioError("INVALID_COMMAND", "Open a recording before exporting it.", {
            details: { reason: "no-recording" },
          });
        }
        const clips = clipsIn(current);
        if (clips.length === 0) {
          throw new AudioError("INVALID_COMMAND", "The recording has no clips to export.", {
            details: { reason: "empty-plan" },
          });
        }
        if (mixLength(current) === 0) {
          throw new AudioError("INVALID_COMMAND", "No track with clips is audible.", {
            details: { reason: "nothing-audible" },
          });
        }
        const { processor } = options;
        if (!processor) throw new TypeError("Exporting needs a processor in createAudioSession.");
        // The sources as they are now: an edit or a close during the export
        // can't change what it renders.
        const used = new Map<string, DecodedAudio>();
        for (const { source } of clips) {
          const held = sources.get(source);
          if (held) used.set(source, held.audio);
        }
        busy += 1;
        changed();
        try {
          const output = await withProcessingTime(
            policy,
            (signal) =>
              processor.render(
                { plan: current, sources: used, format },
                {
                  signal,
                  ...(exportOptions.onProgress ? { onProgress: exportOptions.onProgress } : {}),
                },
              ),
            exportOptions.signal ? { signal: exportOptions.signal } : {},
          );
          emit({
            type: "recording_exported",
            durationSeconds: coarseSeconds(framesToSeconds(mixLength(current), current.sampleRate)),
            sampleRate: current.sampleRate,
            channels: current.channels,
            sampleFormat: format.sampleFormat ?? "pcm16",
          });
          return output;
        } finally {
          busy -= 1;
          changed();
        }
      } catch (reason) {
        if (reason instanceof TypeError || reason instanceof RangeError) throw reason;
        // Whatever a processor rejects with once the caller has aborted, the
        // export was cancelled.
        const failure = exportOptions.signal?.aborted
          ? abortError(exportOptions.signal)
          : asAudioError(reason, "The recording couldn't be exported.");
        emit({ type: "failed", operation: "export", code: failure.code });
        throw failure;
      }
    },

    async close() {
      generation += 1;
      cancelLoads("The recording was closed.");
      const hadRecording = plan !== undefined;
      sources.clear();
      history.clear();
      plan = undefined;
      selection = undefined;
      error = undefined;
      status = "empty";
      changed();
      if (hadRecording) emit({ type: "recording_closed" });
    },
  };
}
