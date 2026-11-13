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
import {
  type AudioClip,
  type AudioPlan,
  EMPTY_METADATA,
  NO_FADE,
  planLength,
} from "../model/plan.js";
import type { AudioPeaks, AudioProbe, AudioSourceInfo, DecodedAudio } from "../model/source.js";
import { framesToSeconds } from "../model/time.js";
import { type AudioCommand, createPlanReducer } from "../operations/commands.js";
import type { AudioEngine } from "../ports/audio-engine.js";
import type {
  AudioExportFormat,
  AudioProcessor,
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
 * A range of the timeline, in frames: `start` inclusive and `end`
 * exclusive, at least one frame long.
 *
 * @public
 */
export interface AudioSelection {
  readonly start: number;
  readonly end: number;
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
export interface AudioInsertOptions extends AudioProgressOptions {
  /**
   * The timeline frame to insert at, splitting the clip there if it's inside
   * one. Defaults to the end.
   */
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
  open(file: Blob, options?: AudioProgressOptions): Promise<void>;
  /**
   * Inserts another recording at a timeline frame, as one undoable step. It
   * must have the session's sample rate; resampling comes later. If the
   * sources held would then exceed `maxSessionSize`, the session first drops
   * history steps, in sdk-core's `dropOrder`, as far as needed to release
   * sources only they refer to, and sets `historyTrimmed`. If even that
   * isn't enough, it rejects with `SESSION_TOO_LARGE` and changes nothing.
   */
  insert(file: Blob, options?: AudioInsertOptions): Promise<void>;
  /**
   * Runs one command, or several as one undoable step. A command that
   * doesn't apply throws `AudioError` with `INVALID_COMMAND`, and one that
   * would exceed `maxClips` throws `TOO_MANY_CLIPS`; either changes
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
   * A clip key no clip has, in the plan or the history, for commands that
   * create clips, such as `newKey` in `audio.splitClip`.
   */
  createKey(): string;
  undo(): void;
  redo(): void;
  /**
   * Selects a range of the timeline, clamped to the plan, or clears the
   * selection with `undefined`. An empty range clears it too.
   */
  select(range: AudioSelection | undefined): void;
  /** A source's waveform overview, or `undefined` for a source the session doesn't hold. */
  getPeaks(source: string): AudioPeaks | undefined;
  /**
   * Renders and encodes the plan as it is now, with the session's
   * `processor`, under `maxProcessingTime`. It returns the file, and never
   * downloads it: the host decides what to do with it. Edits made while it
   * runs don't change it. Rejects with `INVALID_COMMAND` and the reason
   * `no-recording` or `empty-plan` when there's nothing to export, and
   * throws `TypeError` when the session has no processor.
   */
  export(options?: AudioSessionExportOptions): Promise<Blob>;
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
    case "audio.replaceClips":
    case "audio.updateClips":
      return command.clips;
    case "audio.restoreClips":
      return command.entries.map((entry) => entry.clip);
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

/** Every clip key a command names, created or referred to. */
function keysOf(command: AudioCommand): string[] {
  const keys = clipsOf(command).map((clip) => clip.key);
  if ("newKey" in command && typeof command.newKey === "string") keys.push(command.newKey);
  if ("splitKey" in command && typeof command.splitKey === "string") keys.push(command.splitKey);
  return keys;
}

/**
 * Creates an {@link AudioSession}. Pass the engine to use; the headless core
 * doesn't choose one.
 *
 * @example
 * ```ts
 * const session = createAudioSession({ engine: createAudioEngine() });
 * await session.open(file);
 * const [clip] = session.getSnapshot().plan?.clips ?? [];
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
    const ids = new Set(plan?.clips.map((clip) => clip.source));
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
    const clips = plan?.clips.length ?? 0;
    if (clips > 0 && clips >= policy.limits.maxClips.warning) {
      found.push({ type: "limit", limit: "maxClips", actual: clips });
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
    // The selection follows the plan: it can't reach past its end.
    if (selection) {
      const end = Math.min(selection.end, plan ? planLength(plan) : 0);
      selection = selection.start < end ? { start: selection.start, end } : undefined;
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
    beforeDecode: (probe: AudioProbe) => void,
  ): Promise<Source> {
    if (!(file instanceof Blob)) throw new TypeError("A recording must be a Blob or a File.");
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
    beforeDecode(probe);
    const audio = await withProcessingTime(
      policy,
      (limited) =>
        engine.decode(file, probe, { signal: limited, ...(onProgress ? { onProgress } : {}) }),
      { signal },
    );
    // The source is what the decoder returned, capped at the bound, with the
    // decoder's own channel count: mono AAC probes as two channels
    // (docs/adr/0004).
    const frames = Math.min(audio.length, probe.frameBound);
    const channels = audio.numberOfChannels;
    if (audio.sampleRate !== probe.sampleRate || channels < 1 || channels > probe.channels) {
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

  /** Applies commands to the plan, checking `maxClips`, without committing anything. */
  function applyChecked(
    current: AudioPlan,
    commands: readonly AudioCommand[],
  ): { state: AudioPlan; inverses: AudioCommand[] } {
    const result = applyCommands(reducer, current, commands);
    if (result.state.clips.length > current.clips.length) {
      policy.check("maxClips", result.state.clips.length);
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

  function newKey(): string {
    const used = new Set(plan?.clips.map((clip) => clip.key));
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
          load(file, signal, callOptions.onProgress, () => {}),
        );
        const replaced = superseded(started);
        if (replaced) throw replaced;
        // The open recording is released once this one opens, so this one
        // must fit on its own.
        policy.check("maxSessionSize", source.bytes);
        sources.clear();
        history.clear();
        sources.set(source.info.id, source);
        plan = {
          sampleRate: source.info.sampleRate,
          channels: source.info.channels,
          clips: [
            {
              key: newKey(),
              source: source.info.id,
              start: 0,
              end: source.info.frames,
              gainDb: 0,
              fadeIn: NO_FADE,
              fadeOut: NO_FADE,
            },
          ],
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
          return load(file, signal, insertOptions.onProgress, (probe) => {
            const rate = plan?.sampleRate;
            if (probe.sampleRate !== rate) {
              throw new AudioError(
                "UNSUPPORTED_FORMAT",
                `Recordings at ${probe.sampleRate} Hz can't be inserted into a ${rate} Hz session yet.`,
                { details: { sampleRate: probe.sampleRate } },
              );
            }
          });
        });
        const replaced = superseded(started);
        if (replaced) throw replaced;
        const current = plan as AudioPlan;
        // Everything that can fail happens before anything changes.
        const drop = stepsToDrop(source.bytes);
        if (drop === undefined) throw policy.error("maxSessionSize", heldBytes() + source.bytes);
        const commands: AudioCommand[] = [
          {
            type: "audio.insertClips",
            at: insertOptions.at ?? planLength(current),
            clips: [
              {
                key: newKey(),
                source: source.info.id,
                start: 0,
                end: source.info.frames,
                gainDb: 0,
                fadeIn: NO_FADE,
                fadeOut: NO_FADE,
              },
            ],
            splitKey: newKey(),
          },
        ];
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
        commit(applyChecked(plan, copies), copies);
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
        next = from < to ? { start: from, end: to } : undefined;
      }
      if (next?.start === selection?.start && next?.end === selection?.end) return;
      selection = next;
      changed();
    },

    getPeaks: (id) => sources.get(id)?.peaks,

    async export(exportOptions = {}) {
      const current = plan;
      const format: AudioExportFormat = exportOptions.format ?? { container: "wav" };
      try {
        if (!current) {
          throw new AudioError("INVALID_COMMAND", "Open a recording before exporting it.", {
            details: { reason: "no-recording" },
          });
        }
        if (current.clips.length === 0) {
          throw new AudioError("INVALID_COMMAND", "The recording has no clips to export.", {
            details: { reason: "empty-plan" },
          });
        }
        const { processor } = options;
        if (!processor) throw new TypeError("Exporting needs a processor in createAudioSession.");
        // The sources as they are now: an edit or a close during the export
        // can't change what it renders.
        const used = new Map<string, DecodedAudio>();
        for (const { source } of current.clips) {
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
            durationSeconds: coarseSeconds(
              framesToSeconds(planLength(current), current.sampleRate),
            ),
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
