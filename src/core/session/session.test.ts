import { describe, expect, it, vi } from "vitest";
import { encodeFakeAudio, type FakeAudioFile } from "../../../test/fakes/fake-audio.js";
import { createFakeEngine } from "../../../test/fakes/fake-engine.js";
import { createFakeProcessor, readFakeWav } from "../../../test/fakes/fake-processor.js";
import { isAudioError } from "../errors/audio-error.js";
import type { AudioFilePolicyOverrides } from "../errors/audio-limits.js";
import { planLength } from "../model/plan.js";
import type { AudioProcessor } from "../ports/audio-processor.js";
import { type AudioSessionEvent, createAudioSession } from "./session.js";

const RATE = 8_000;

/** A fake recording of `frames` frames on each of `channels` channels. */
function recording(frames: number, channels = 1, extra: Partial<FakeAudioFile> = {}): Blob {
  const samples = Array.from({ length: channels }, (_, c) =>
    Array.from({ length: frames }, (_, i) => ((i + c) % 10) / 20),
  );
  return encodeFakeAudio({ sampleRate: RATE, samples, ...extra });
}

/** Decoded bytes of a recording, as the session counts them. */
const bytes = (frames: number, channels = 1) => frames * channels * 4;

function setup(
  filePolicy: AudioFilePolicyOverrides = {},
  processor: AudioProcessor | null = createFakeProcessor(),
) {
  const engine = createFakeEngine();
  const decode = vi.spyOn(engine, "decode");
  const events: AudioSessionEvent[] = [];
  const session = createAudioSession({
    engine,
    filePolicy,
    ...(processor ? { processor } : {}),
    onEvent: (event) => events.push(event),
  });
  const snapshot = () => session.getSnapshot();
  const keys = () => snapshot().plan?.clips.map((clip) => clip.key) ?? [];
  return { session, engine, decode, events, snapshot, keys };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

describe("the audio session", () => {
  it("opens a recording as one clip over its decoded source", async () => {
    const { session, snapshot, events } = setup();
    expect(snapshot()).toMatchObject({ status: "empty", plan: undefined, busy: false });
    await session.open(recording(400, 2));
    const { plan, sources, status, sessionBytes, canUndo } = snapshot();
    expect(status).toBe("ready");
    expect(plan).toMatchObject({ sampleRate: RATE, channels: 2 });
    expect(plan?.clips).toEqual([
      expect.objectContaining({ source: sources[0]?.id, start: 0, end: 400, gainDb: 0 }),
    ]);
    expect(sources).toEqual([
      expect.objectContaining({ sampleRate: RATE, channels: 2, frames: 400, codec: "pcm" }),
    ]);
    expect(sessionBytes).toBe(bytes(400, 2));
    expect(canUndo).toBe(false);
    expect(session.getPeaks(sources[0]?.id as string)?.levels.length).toBeGreaterThan(0);
    expect(events).toEqual([
      {
        type: "recording_opened",
        durationSeconds: 400 / RATE,
        sampleRate: RATE,
        channels: 2,
        container: "wav",
        codec: "pcm",
        truncated: false,
      },
    ]);
  });

  it("takes channels and memory from the decoded audio, not the probe's maximum", async () => {
    // Mono AAC probes as two channels (docs/adr/0001).
    const { session, snapshot } = setup();
    await session.open(recording(400, 1, { probeChannels: 2 }));
    expect(snapshot().plan?.channels).toBe(1);
    expect(snapshot().sources[0]?.channels).toBe(1);
    expect(snapshot().sessionBytes).toBe(bytes(400));
  });

  it("opens a truncated recording with a warning", async () => {
    const { session, snapshot, events } = setup();
    await session.open(recording(400, 1, { declaredFrames: 1_000, truncated: true }));
    const source = snapshot().sources[0]?.id;
    expect(snapshot().plan?.clips[0]?.end).toBe(400);
    expect(snapshot().warnings).toEqual([
      { type: "truncated", source, frames: 400, declaredFrames: 1_000 },
    ]);
    expect(events[0]).toMatchObject({ type: "recording_opened", truncated: true });
  });

  it("checks the probe against the limits before decoding", async () => {
    const { session, snapshot, decode } = setup({ maxChannels: 2, maxDuration: 1_000 });
    const tooWide = await rejection(session.open(recording(10, 3)));
    expect(isAudioError(tooWide, "TOO_MANY_CHANNELS")).toBe(true);
    const tooLong = await rejection(session.open(recording(RATE + 1)));
    expect(isAudioError(tooLong, "DURATION_TOO_LONG")).toBe(true);
    expect(decode).not.toHaveBeenCalled();
    expect(snapshot()).toMatchObject({ status: "error", plan: undefined });
    expect(isAudioError(snapshot().error, "DURATION_TOO_LONG")).toBe(true);
  });

  it("reports values past a warning threshold, per source", async () => {
    const { session, snapshot } = setup({ maxDuration: { maximum: 10_000, warning: 1_000 } });
    await session.open(recording(RATE * 2));
    expect(snapshot().warnings).toEqual([
      { type: "limit", limit: "maxDuration", actual: 2_000, source: snapshot().sources[0]?.id },
    ]);
  });

  it("keeps the open recording and its history when another fails to open", async () => {
    const { session, snapshot, keys, events } = setup();
    await session.open(recording(100));
    session.execute({ type: "audio.setGain", keys: keys(), gainDb: -6 });
    const before = snapshot().plan;
    const error = await rejection(session.open(new Blob(["not audio"])));
    expect(isAudioError(error, "UNSUPPORTED_FORMAT")).toBe(true);
    expect(snapshot()).toMatchObject({ status: "ready", plan: before, canUndo: true });
    expect(snapshot().error).toBe(error);
    expect(events.at(-1)).toEqual({
      type: "failed",
      operation: "open",
      code: "UNSUPPORTED_FORMAT",
    });
  });

  it("replaces the recording and its history with the next one opened", async () => {
    const { session, snapshot, keys } = setup();
    await session.open(recording(100));
    session.execute({ type: "audio.setGain", keys: keys(), gainDb: -6 });
    await session.open(recording(50));
    expect(snapshot()).toMatchObject({ canUndo: false, error: undefined });
    expect(snapshot().sources).toHaveLength(1);
    expect(planLength(snapshot().plan as never)).toBe(50);
  });

  it("lets only the latest of two opens report", async () => {
    const { session, snapshot } = setup();
    const first = session.open(recording(100));
    const second = session.open(recording(50));
    expect(isAudioError(await rejection(first), "ABORTED")).toBe(true);
    await second;
    expect(snapshot()).toMatchObject({ status: "ready", error: undefined, busy: false });
    expect(planLength(snapshot().plan as never)).toBe(50);
  });

  it("cancels an open when closed, and stays empty", async () => {
    const { session, snapshot, events } = setup();
    const opening = session.open(recording(100));
    await session.close();
    expect(isAudioError(await rejection(opening), "ABORTED")).toBe(true);
    expect(snapshot()).toMatchObject({ status: "empty", plan: undefined, error: undefined });
    expect(events).toEqual([]);
  });

  it("executes commands, and undoes and redoes them", async () => {
    const { session, snapshot, keys, events } = setup();
    await session.open(recording(100));
    const [key] = keys();
    const newKey = session.createKey();
    session.execute({ type: "audio.splitClip", key: key as string, at: 40, newKey });
    expect(keys()).toEqual([key, newKey]);
    session.undo();
    expect(keys()).toEqual([key]);
    expect(snapshot().canRedo).toBe(true);
    session.redo();
    expect(keys()).toEqual([key, newKey]);
    expect(events.slice(1).map((event) => event.type)).toEqual(["command", "undo", "redo"]);
  });

  it("refuses invalid commands without changing anything", async () => {
    const { session, snapshot, events } = setup();
    expect(thrown(() => session.execute({ type: "audio.removeClips", keys: ["x"] }))).toMatchObject(
      {
        code: "INVALID_COMMAND",
        details: { reason: "no-recording" },
      },
    );
    expect(await rejection(session.insert(recording(10)))).toMatchObject({
      code: "INVALID_COMMAND",
      details: { reason: "no-recording" },
    });
    await session.open(recording(100));
    const before = snapshot();
    const error = thrown(() => session.execute({ type: "audio.removeClips", keys: ["x"] }));
    expect(error).toMatchObject({ code: "INVALID_COMMAND", details: { reason: "unknown-clip" } });
    expect(snapshot()).toBe(before);
    expect(events.at(-1)).toEqual({
      type: "failed",
      operation: "command",
      code: "INVALID_COMMAND",
    });
    const notData = thrown(() =>
      session.execute({ type: "audio.setMetadata", field: "title", value: (() => "") as never }),
    );
    expect(notData).toMatchObject({
      code: "INVALID_COMMAND",
      details: { reason: "not-plain-data" },
    });
  });

  it("keeps its own copies of commands", async () => {
    const { session, keys } = setup();
    await session.open(recording(100));
    const command = { type: "audio.setGain" as const, keys: [...keys()], gainDb: -6 };
    session.execute(command);
    command.keys[0] = "changed";
    session.undo();
    session.redo();
    expect(keys()).toHaveLength(1);
  });

  it("refuses commands that would exceed maxClips", async () => {
    const { session, snapshot, keys } = setup({ maxClips: 2 });
    await session.open(recording(100));
    const [key] = keys() as [string];
    session.execute({ type: "audio.splitClip", key, at: 50, newKey: session.createKey() });
    const before = snapshot();
    const error = thrown(() =>
      session.execute({ type: "audio.splitClip", key, at: 20, newKey: session.createKey() }),
    );
    expect(isAudioError(error, "TOO_MANY_CLIPS")).toBe(true);
    expect(snapshot()).toBe(before);
  });

  it("records the commands of a group as one step", async () => {
    const { session, keys } = setup();
    await session.open(recording(100));
    session.group(() => {
      session.execute({ type: "audio.setGain", keys: keys(), gainDb: -3 });
      session.execute({ type: "audio.setGain", keys: keys(), gainDb: -6 });
    });
    session.undo();
    expect(session.getSnapshot().plan?.clips[0]?.gainDb).toBe(0);
    expect(session.getSnapshot().canUndo).toBe(false);
  });

  it("creates keys that no clip has, in the plan or the history", async () => {
    const { session, keys } = setup();
    await session.open(recording(100));
    const [key] = keys() as [string];
    session.execute({ type: "audio.splitClip", key, at: 50, newKey: "c2" });
    session.execute({ type: "audio.removeClips", keys: ["c2"] });
    // c2 is only in the history now, which can bring it back.
    expect(session.createKey()).not.toBe("c2");
  });

  it("inserts a recording at the end, or splitting the clip at a frame, as one step", async () => {
    const { session, snapshot, events } = setup();
    await session.open(recording(100));
    await session.insert(recording(30));
    expect(planLength(snapshot().plan as never)).toBe(130);
    expect(snapshot().sources).toHaveLength(2);
    await session.insert(recording(20), { at: 40 });
    expect(snapshot().plan?.clips.map((clip) => clip.end - clip.start)).toEqual([40, 20, 60, 30]);
    session.undo();
    session.undo();
    expect(planLength(snapshot().plan as never)).toBe(100);
    // Undo can bring them back, so the session still holds them.
    expect(snapshot().sources).toHaveLength(3);
    expect(events.filter((event) => event.type === "recording_inserted")).toHaveLength(2);
  });

  it("refuses to insert a recording at another sample rate, before decoding", async () => {
    const { session, snapshot, decode } = setup();
    await session.open(recording(100));
    decode.mockClear();
    const other = encodeFakeAudio({ sampleRate: 16_000, samples: [[0, 0.1]] });
    const error = await rejection(session.insert(other));
    expect(isAudioError(error, "UNSUPPORTED_FORMAT")).toBe(true);
    expect(decode).not.toHaveBeenCalled();
    expect(snapshot().sources).toHaveLength(1);
    expect(snapshot().error).toBe(error);
  });

  it("refuses an insert past maxFiles", async () => {
    const { session } = setup({ maxFiles: 1 });
    await session.open(recording(100));
    expect(isAudioError(await rejection(session.insert(recording(10))), "TOO_MANY_FILES")).toBe(
      true,
    );
  });

  it("releases sources only the redo steps held once a new step drops them", async () => {
    const { session, snapshot, keys } = setup();
    await session.open(recording(100));
    await session.insert(recording(30));
    session.undo();
    expect(snapshot().sources).toHaveLength(2);
    session.execute({ type: "audio.setGain", keys: keys(), gainDb: -1 });
    expect(snapshot().sources).toHaveLength(1);
    expect(snapshot().sessionBytes).toBe(bytes(100));
  });

  it("drops history to fit an insert within maxSessionSize, and says so", async () => {
    const { session, snapshot } = setup({
      maxSessionSize: { maximum: bytes(250), warning: bytes(200) },
    });
    await session.open(recording(100));
    await session.insert(recording(100));
    const inserted = snapshot().plan?.clips[1]?.key as string;
    session.execute({ type: "audio.removeClips", keys: [inserted] });
    expect(snapshot().sessionBytes).toBe(bytes(200));
    expect(snapshot().warnings).toContainEqual({
      type: "limit",
      limit: "maxSessionSize",
      actual: bytes(200),
    });
    // The removed source is held only by the history; dropping it makes room.
    await session.insert(recording(100));
    expect(snapshot()).toMatchObject({ historyTrimmed: true, sessionBytes: bytes(200) });
    expect(snapshot().sources).toHaveLength(2);
  });

  it("refuses an insert that doesn't fit even without history, changing nothing", async () => {
    const { session, snapshot } = setup({ maxSessionSize: bytes(150) });
    await session.open(recording(100));
    session.execute({
      type: "audio.setGain",
      keys: [snapshot().plan?.clips[0]?.key as string],
      gainDb: -1,
    });
    const error = await rejection(session.insert(recording(100)));
    expect(isAudioError(error, "SESSION_TOO_LARGE")).toBe(true);
    expect(snapshot()).toMatchObject({ canUndo: true, historyTrimmed: false });
    expect(snapshot().sources).toHaveLength(1);
  });

  it("clamps the selection to the plan, and follows it as it shrinks", async () => {
    const { session, snapshot, keys } = setup();
    session.select({ start: 0, end: 10 });
    expect(snapshot().selection).toBeUndefined();
    await session.open(recording(100));
    session.select({ start: 80, end: 20 });
    expect(snapshot().selection).toEqual({ start: 20, end: 80 });
    session.select({ start: -5, end: 500 });
    expect(snapshot().selection).toEqual({ start: 0, end: 100 });
    session.execute({ type: "audio.deleteRange", start: 50, end: 100 });
    expect(snapshot().selection).toEqual({ start: 0, end: 50 });
    session.execute({ type: "audio.removeClips", keys: keys() });
    expect(snapshot().selection).toBeUndefined();
    expect(() => session.select({ start: 0.5, end: 2 })).toThrow(RangeError);
  });

  it("notifies subscribers with a new frozen snapshot on each change", async () => {
    const { session } = setup();
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    await session.open(recording(100));
    expect(listener).toHaveBeenCalled();
    expect(Object.isFrozen(session.getSnapshot())).toBe(true);
    unsubscribe();
    listener.mockClear();
    await session.close();
    expect(listener).not.toHaveBeenCalled();
  });

  it("closes, releasing every source", async () => {
    const { session, snapshot, events } = setup();
    await session.open(recording(100));
    await session.close();
    expect(snapshot()).toMatchObject({
      status: "empty",
      plan: undefined,
      sources: [],
      sessionBytes: 0,
      canUndo: false,
    });
    expect(events.at(-1)).toEqual({ type: "recording_closed" });
  });

  describe("export", () => {
    it("renders the plan as it is when the export starts, and returns the file", async () => {
      const { session, keys, snapshot, events } = setup();
      await session.open(recording(400, 2));
      session.execute({
        type: "audio.deleteRange",
        start: 100,
        end: 300,
        newKey: session.createKey(),
      });
      const busy: boolean[] = [];
      const unsubscribe = session.subscribe(() => busy.push(snapshot().busy));
      const exporting = session.export({ format: { container: "wav", sampleFormat: "float32" } });
      // An edit while it runs doesn't change what it renders.
      session.execute({ type: "audio.setGain", keys: keys(), gainDb: -20 });
      const wav = await readFakeWav(await exporting);
      unsubscribe();
      expect(wav).toMatchObject({ sampleRate: RATE, sampleFormat: "float32" });
      expect(wav.samples).toHaveLength(2);
      expect(wav.samples[0]).toHaveLength(200);
      expect(wav.samples[0]?.[150]).toBeCloseTo(((300 + 50) % 10) / 20, 6);
      expect(busy).toContain(true);
      expect(snapshot().busy).toBe(false);
      expect(events.at(-1)).toEqual({
        type: "recording_exported",
        durationSeconds: 0.025,
        sampleRate: RATE,
        channels: 2,
        sampleFormat: "float32",
      });
    });

    it("refuses when there's nothing to export", async () => {
      const { session, keys, events } = setup();
      expect(await rejection(session.export())).toMatchObject({
        code: "INVALID_COMMAND",
        details: { reason: "no-recording" },
      });
      await session.open(recording(100));
      session.execute({ type: "audio.removeClips", keys: keys() });
      expect(await rejection(session.export())).toMatchObject({
        code: "INVALID_COMMAND",
        details: { reason: "empty-plan" },
      });
      expect(events.at(-1)).toEqual({
        type: "failed",
        operation: "export",
        code: "INVALID_COMMAND",
      });
    });

    it("needs a processor", async () => {
      const { session } = setup({}, null);
      await session.open(recording(100));
      await expect(session.export()).rejects.toThrow(TypeError);
    });

    it("stops at maxProcessingTime, and on the caller's signal", async () => {
      // A processor that only ever stops when it's told to.
      const stuck: AudioProcessor = {
        render: (_, options = {}) =>
          new Promise((_, reject) => {
            options.signal?.addEventListener("abort", () => reject(options.signal?.reason));
          }),
        destroy: async () => {},
      };
      const { session, snapshot } = setup({ maxProcessingTime: 20 }, stuck);
      await session.open(recording(100));
      expect(isAudioError(await rejection(session.export()), "PROCESSING_TIME_EXCEEDED")).toBe(
        true,
      );
      expect(snapshot().busy).toBe(false);
      const controller = new AbortController();
      const exporting = session.export({ signal: controller.signal });
      controller.abort();
      expect(isAudioError(await rejection(exporting), "ABORTED")).toBe(true);
    });

    it("reports durations in events to two significant figures", async () => {
      const { session, events } = setup();
      // 27,653 frames at 8 kHz is 3.456625 seconds.
      await session.open(recording(27_653));
      await session.export();
      expect(events.map((event) => "durationSeconds" in event && event.durationSeconds)).toEqual([
        3.5, 3.5,
      ]);
    });
  });
});
