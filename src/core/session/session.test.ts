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
  /** Every clip of the plan, track by track. */
  const clips = () => snapshot().plan?.tracks.flatMap((track) => track.clips) ?? [];
  const keys = () => clips().map((clip) => clip.key);
  const trackKeys = () => snapshot().plan?.tracks.map((track) => track.key) ?? [];
  /** A range deletion that closes the gap, on every track. */
  const ripple = (start: number, end: number) =>
    ({
      type: "audio.deleteRange",
      start,
      end,
      tracks: trackKeys(),
      ripple: true,
      newKeys: Object.fromEntries(trackKeys().map((key) => [key, session.createKey()])),
    }) as const;
  return { session, engine, decode, events, snapshot, clips, keys, trackKeys, ripple };
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
    expect(plan).toMatchObject({ gainDb: 0 });
    expect(plan?.tracks).toEqual([
      {
        key: expect.any(String),
        name: "",
        gainDb: 0,
        muted: false,
        soloed: false,
        clips: [
          expect.objectContaining({ source: sources[0]?.id, at: 0, start: 0, end: 400, gainDb: 0 }),
        ],
      },
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
    const { session, snapshot, events, clips } = setup();
    await session.open(recording(400, 1, { declaredFrames: 1_000, truncated: true }));
    const source = snapshot().sources[0]?.id;
    expect(clips()[0]?.end).toBe(400);
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

  it("refuses commands and inserts that would exceed maxTracks, and warns at its threshold", async () => {
    const { session, snapshot } = setup({ maxTracks: { maximum: 3, warning: 2 } });
    await session.open(recording(100));
    expect(snapshot().warnings).toEqual([]);
    session.execute({ type: "audio.addTrack", key: "second", index: 1 });
    expect(snapshot().warnings).toEqual([{ type: "limit", limit: "maxTracks", actual: 2 }]);
    // An insert adds a track too.
    await session.insert(recording(10));
    const before = snapshot();
    const error = thrown(() =>
      session.execute({ type: "audio.addTrack", key: "fourth", index: 0 }),
    );
    expect(error).toMatchObject({
      code: "TOO_MANY_TRACKS",
      details: { limit: "maxTracks", maximum: 3, actual: 4 },
    });
    expect(snapshot()).toBe(before);
    const failed = await rejection(session.insert(recording(10)));
    expect(isAudioError(failed, "TOO_MANY_TRACKS")).toBe(true);
    // Nothing of the refused insert is kept.
    expect(snapshot().sources).toHaveLength(2);
    expect(snapshot().plan?.tracks).toHaveLength(3);
    // On a track that's there, it's fine.
    await session.insert(recording(10), { track: "second" });
    // Removing one makes room again.
    session.execute({ type: "audio.removeTracks", keys: ["second"] });
    session.execute({ type: "audio.addTrack", key: "fourth", index: 0 });
    expect(snapshot().plan?.tracks).toHaveLength(3);
  });

  it("allows sixteen tracks by default", async () => {
    const { session, snapshot } = setup();
    await session.open(recording(10));
    for (let index = 1; index < 16; index += 1) {
      session.execute({ type: "audio.addTrack", key: `t${index}`, index });
    }
    expect(snapshot().plan?.tracks).toHaveLength(16);
    expect(
      isAudioError(
        thrown(() => session.execute({ type: "audio.addTrack", key: "t16", index: 16 })),
        "TOO_MANY_TRACKS",
      ),
    ).toBe(true);
  });

  it("refuses an edit that would make the plan longer than maxDuration", async () => {
    // One second at 8 kHz.
    const { session, snapshot, keys, trackKeys } = setup({ maxDuration: 1_000 });
    await session.open(recording(4_000));
    const [key] = keys() as [string];
    const [track] = trackKeys() as [string];
    // Up to the limit, to the frame.
    session.execute({ type: "audio.moveClips", keys: [key], by: 4_000 });
    expect(planLength(snapshot().plan as never)).toBe(8_000);
    const before = snapshot();
    for (const command of [
      { type: "audio.moveClips", keys: [key], by: 1 },
      { type: "audio.insertTime", at: 0, frames: 1, tracks: [track] },
    ] as const) {
      expect(thrown(() => session.execute(command))).toMatchObject({
        code: "DURATION_TOO_LONG",
        details: { limit: "maxDuration", maximum: 1_000, actual: 1_001, reason: "plan-too-long" },
      });
    }
    expect(snapshot()).toBe(before);
    // An insert that would reach past it, on a new track or on this one.
    for (const options of [{ at: 7_999 }, { track, at: 8_000 }, { at: 90_000_000 }]) {
      const failed = await rejection(session.insert(recording(10), options));
      expect(isAudioError(failed, "DURATION_TOO_LONG")).toBe(true);
    }
    expect(snapshot().sources).toHaveLength(1);
    // Edits that don't lengthen it are fine at the limit, and shortening is.
    session.execute({ type: "audio.setGain", keys: [key], gainDb: -3 });
    session.execute({ type: "audio.moveClips", keys: [key], by: -1 });
    await session.insert(recording(10), { at: 7_000 });
    expect(snapshot().sources).toHaveLength(2);
  });

  it("gives commands the keys they leave out, and records them, so undo and redo stay exact", async () => {
    const { session, snapshot, keys, trackKeys, clips } = setup();
    await session.open(recording(100));
    const [key] = keys() as [string];
    const [track] = trackKeys() as [string];
    session.execute([
      { type: "audio.splitClip", key, at: 50 },
      { type: "audio.addTrack", index: 1 },
    ]);
    const added = trackKeys()[1] as string;
    const [first, second] = keys() as [string, string];
    expect(new Set([track, added, first, second]).size).toBe(4);
    // A range inside a clip needs a key for the part after it.
    session.execute({
      type: "audio.deleteRange",
      start: 60,
      end: 70,
      tracks: [track],
      ripple: true,
    });
    expect(clips().map((clip) => [clip.at, clip.end - clip.start])).toEqual([
      [0, 50],
      [50, 10],
      [60, 30],
    ]);
    const after = snapshot().plan;
    session.undo();
    session.undo();
    expect(trackKeys()).toEqual([track]);
    session.redo();
    session.redo();
    // The same keys, not new ones: the history recorded them.
    expect(snapshot().plan).toEqual(after);
    // A key that's given is used.
    session.execute({ type: "audio.addTrack", key: "music", index: 0 });
    expect(trackKeys()[0]).toBe("music");
  });

  it("succeeds without an undo step for a command that changes nothing", async () => {
    const { session, snapshot, keys, events } = setup();
    await session.open(recording(100));
    session.execute({ type: "audio.setGain", keys: keys(), gainDb: -6 });
    const before = snapshot();
    const commands = events.length;
    // The same gain again, and a master gain that's already 0 dB.
    session.execute({ type: "audio.setGain", keys: keys(), gainDb: -6 });
    session.execute({ type: "audio.setMasterGain", gainDb: 0 });
    expect(snapshot()).toBe(before);
    expect(events).toHaveLength(commands);
    // One undo takes the one change away.
    session.undo();
    expect(snapshot().canUndo).toBe(false);
    // A command that doesn't apply is still refused.
    expect(
      isAudioError(
        thrown(() => session.execute({ type: "audio.setGain", keys: ["nope"], gainDb: 0 })),
        "INVALID_COMMAND",
      ),
    ).toBe(true);
  });

  it("keeps a name for each recording, cleaned, from the host or the file, and never in events", async () => {
    const { session, snapshot, events } = setup();
    const file = new File([await recording(100).arrayBuffer()], "interview.wav");
    await session.open(file);
    expect(snapshot().sources[0]?.name).toBe("interview.wav");
    // A bidirectional override would show "vaw.exe" as "exe.wav".
    await session.insert(recording(10), { name: "  Music \u202Evaw.exe\u0007  " });
    expect(snapshot().sources[1]?.name).toBe("Music vaw.exe");
    await session.insert(recording(10), { name: "\u200E\u0000 " });
    expect(snapshot().sources[2]).not.toHaveProperty("name");
    await session.insert(recording(10), { name: "\u{1F399}".repeat(300) });
    expect([...(snapshot().sources[3]?.name ?? "")]).toHaveLength(128);
    // Only the last segment of a path, as pdf-sdk keeps it.
    await session.insert(recording(10), { name: "C:\\Users\\me\\take<2>.wav" });
    expect(snapshot().sources[4]?.name).toBe("take2.wav");
    await session.insert(recording(10));
    expect(snapshot().sources[5]).not.toHaveProperty("name");
    expect(JSON.stringify(events)).not.toContain("interview");
    expect(JSON.stringify(events)).not.toContain("Music");
    expect(JSON.stringify(snapshot().plan)).not.toContain("interview");
  });

  it("works with its methods passed on their own, as useSyncExternalStore takes them", async () => {
    const { session } = setup();
    const { getSnapshot, subscribe, open, execute, createKey } = session;
    const changes: unknown[] = [];
    const unsubscribe = subscribe(() => changes.push(getSnapshot()));
    await open(recording(100));
    execute({ type: "audio.addTrack", key: createKey(), index: 1 });
    unsubscribe();
    expect(changes.length).toBeGreaterThan(1);
    expect(getSnapshot().plan?.tracks).toHaveLength(2);
  });

  it("destroys nothing it was given when it closes", async () => {
    const engine = createFakeEngine();
    const processor = createFakeProcessor();
    const destroyed = [vi.spyOn(engine, "destroy"), vi.spyOn(processor, "destroy")];
    const session = createAudioSession({ engine, processor });
    await session.open(recording(100));
    await session.close();
    for (const spy of destroyed) expect(spy).not.toHaveBeenCalled();
    // Both still work, for another session or the same one.
    await session.open(recording(10));
    expect((await session.export()).blob.size).toBeGreaterThan(0);
  });

  it("records the commands of a group as one step", async () => {
    const { session, keys } = setup();
    await session.open(recording(100));
    session.group(() => {
      session.execute({ type: "audio.setGain", keys: keys(), gainDb: -3 });
      session.execute({ type: "audio.setGain", keys: keys(), gainDb: -6 });
    });
    session.undo();
    expect(session.getSnapshot().plan?.tracks[0]?.clips[0]?.gainDb).toBe(0);
    expect(session.getSnapshot().canUndo).toBe(false);
  });

  it("creates keys that no track or clip has, in the plan or the history", async () => {
    const { session, keys, trackKeys } = setup();
    await session.open(recording(100));
    // The track and the clip took the first two keys.
    expect([...trackKeys(), ...keys()]).toEqual(["c1", "c2"]);
    const [key] = keys() as [string];
    session.execute({ type: "audio.splitClip", key, at: 50, newKey: "c3" });
    session.execute({ type: "audio.removeClips", keys: ["c3"] });
    // c3 is only in the history now, which can bring it back.
    expect(session.createKey()).toBe("c4");
    session.execute({ type: "audio.addTrack", key: "c5", index: 1 });
    expect(session.createKey()).toBe("c6");
  });

  it("adds a recording on a new track of its own, as one step", async () => {
    const { session, snapshot, events, clips } = setup();
    await session.open(recording(100));
    await session.insert(recording(30));
    // Under the first, from the start: the plan is no longer.
    expect(snapshot().plan?.tracks.map((track) => track.clips.length)).toEqual([1, 1]);
    expect(snapshot().plan?.tracks[1]).toMatchObject({ name: "", gainDb: 0, muted: false });
    expect(clips().map((clip) => [clip.at, clip.end - clip.start])).toEqual([
      [0, 100],
      [0, 30],
    ]);
    expect(planLength(snapshot().plan as never)).toBe(100);
    expect(snapshot().sources).toHaveLength(2);
    await session.insert(recording(20), { at: 140 });
    expect(snapshot().plan?.tracks).toHaveLength(3);
    expect(planLength(snapshot().plan as never)).toBe(160);
    // One undo takes the track and its clip away together.
    session.undo();
    expect(snapshot().plan?.tracks).toHaveLength(2);
    session.undo();
    expect(snapshot().plan?.tracks).toHaveLength(1);
    expect(planLength(snapshot().plan as never)).toBe(100);
    // Undo can bring them back, so the session still holds them.
    expect(snapshot().sources).toHaveLength(3);
    expect(events.filter((event) => event.type === "recording_inserted")).toHaveLength(2);
    session.redo();
    expect(clips().map((clip) => clip.at)).toEqual([0, 0]);
  });

  it("adds a recording to a named track, where there's room", async () => {
    const { session, snapshot, clips, trackKeys } = setup();
    await session.open(recording(100));
    const [track] = trackKeys() as [string];
    await session.insert(recording(30), { track, at: 100 });
    expect(snapshot().plan?.tracks).toHaveLength(1);
    expect(clips().map((clip) => clip.at)).toEqual([0, 100]);
    // Where there's none, nothing changes, and the source isn't kept.
    const error = await rejection(session.insert(recording(30), { track, at: 90 }));
    expect(error).toMatchObject({ code: "INVALID_COMMAND", details: { reason: "clips-overlap" } });
    expect(clips()).toHaveLength(2);
    expect(snapshot().sources).toHaveLength(2);
    expect(await rejection(session.insert(recording(30), { track: "nowhere" }))).toMatchObject({
      details: { reason: "unknown-track" },
    });
  });

  it("widens the plan for a recording with more channels, and never narrows it", async () => {
    const { session, snapshot } = setup();
    await session.open(recording(100, 1));
    expect(snapshot().plan?.channels).toBe(1);
    await session.insert(recording(50, 2));
    expect(snapshot().plan?.channels).toBe(2);
    await session.insert(recording(50, 1));
    expect(snapshot().plan?.channels).toBe(2);
    // The widening is part of the insert's step.
    session.undo();
    session.undo();
    expect(snapshot().plan).toMatchObject({ channels: 1 });
    expect(snapshot().plan?.tracks).toHaveLength(1);
  });

  it("converts a recording at another sample rate to the session's as it's inserted", async () => {
    const { session, snapshot, decode } = setup();
    await session.open(recording(100));
    decode.mockClear();
    const samples = [Array.from({ length: 30 }, (_, i) => i / 100)];
    await session.insert(encodeFakeAudio({ sampleRate: 12_000, samples }));
    // The engine is asked for the session's rate, and only when it differs.
    expect(decode.mock.calls[0]?.[2]).toMatchObject({ sampleRate: RATE });
    const [first, inserted] = snapshot().sources;
    expect(first).not.toHaveProperty("resampledFrom");
    // 30 frames at 12 kHz are 20 at 8 kHz: the same time.
    expect(inserted).toMatchObject({ sampleRate: RATE, frames: 20, resampledFrom: 12_000 });
    // On its own track, 20 frames long, under the first.
    expect(snapshot().plan?.tracks[1]?.clips[0]).toMatchObject({ at: 0, start: 0, end: 20 });
    expect(snapshot().plan?.sampleRate).toBe(RATE);
    expect(snapshot().sessionBytes).toBe(bytes(120));
    expect(session.getAudio(inserted?.id ?? "")).toMatchObject({ sampleRate: RATE, length: 20 });

    await session.insert(recording(10));
    expect(decode.mock.calls[1]?.[2]).not.toHaveProperty("sampleRate");
  });

  it("checks a converted recording's size before decoding it", async () => {
    // 40 frames at 2 kHz fit maxDecodedSize; the 160 they become at 8 kHz don't.
    const { session, snapshot, decode } = setup({ maxDecodedSize: bytes(100) });
    await session.open(recording(100));
    decode.mockClear();
    const slow = encodeFakeAudio({ sampleRate: 2_000, samples: [new Array(40).fill(0.1)] });
    const error = await rejection(session.insert(slow));
    expect(isAudioError(error, "DECODED_SIZE_TOO_LARGE")).toBe(true);
    expect(decode).not.toHaveBeenCalled();
    expect(snapshot().sources).toHaveLength(1);
    expect(snapshot().error).toBe(error);
  });

  it("refuses an engine's audio that isn't at the rate it was asked for", async () => {
    const { session, decode } = setup();
    await session.open(recording(100));
    const deaf = createFakeEngine();
    decode.mockImplementation((file, probe, options) =>
      deaf.decode(file, probe, { ...options, sampleRate: probe.sampleRate }),
    );
    const other = encodeFakeAudio({ sampleRate: 16_000, samples: [[0, 0.1]] });
    expect(isAudioError(await rejection(session.insert(other)), "INVALID_AUDIO")).toBe(true);
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
    const { session, snapshot, clips } = setup({
      maxSessionSize: { maximum: bytes(250), warning: bytes(200) },
    });
    await session.open(recording(100));
    await session.insert(recording(100));
    const inserted = clips()[1]?.key as string;
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
    const { session, snapshot, clips } = setup({ maxSessionSize: bytes(150) });
    await session.open(recording(100));
    session.execute({
      type: "audio.setGain",
      keys: [clips()[0]?.key as string],
      gainDb: -1,
    });
    const error = await rejection(session.insert(recording(100)));
    expect(isAudioError(error, "SESSION_TOO_LARGE")).toBe(true);
    expect(snapshot()).toMatchObject({ canUndo: true, historyTrimmed: false });
    expect(snapshot().sources).toHaveLength(1);
  });

  it("clamps the selection to the plan, and follows it as it shrinks", async () => {
    const { session, snapshot, keys, trackKeys } = setup();
    session.select({ start: 0, end: 10 });
    expect(snapshot().selection).toBeUndefined();
    await session.open(recording(100));
    const tracks = trackKeys();
    session.select({ start: 80, end: 20 });
    expect(snapshot().selection).toEqual({ start: 20, end: 80, tracks });
    session.select({ start: -5, end: 500 });
    expect(snapshot().selection).toEqual({ start: 0, end: 100, tracks });
    // A trim shortens the plan without moving anything: the range follows it.
    const [key] = keys() as [string];
    session.execute({ type: "audio.trimClip", key, start: 0, end: 50 });
    expect(snapshot().selection).toEqual({ start: 0, end: 50, tracks });
    session.execute({ type: "audio.removeClips", keys: keys() });
    expect(snapshot().selection).toBeUndefined();
    expect(() => session.select({ start: 0.5, end: 2 })).toThrow(RangeError);
  });

  it("clears the selection after a time edit, and keeps it through other edits, undo and redo", async () => {
    const { session, snapshot, keys, trackKeys } = setup();
    await session.open(recording(100));
    const tracks = trackKeys();
    const [track] = tracks as [string];
    const range = { start: 20, end: 40, tracks };
    for (const command of [
      { type: "audio.deleteRange", start: 60, end: 70, tracks, ripple: true },
      { type: "audio.keepRange", start: 0, end: 90 },
      { type: "audio.insertTime", at: 0, frames: 5, tracks: [track] },
    ] as const) {
      session.select(range);
      session.execute(command);
      expect(snapshot().selection, command.type).toBeUndefined();
      // Undo and redo keep whatever selection there is now.
      session.select(range);
      session.undo();
      expect(snapshot().selection).toEqual(range);
      session.redo();
      expect(snapshot().selection).toEqual(range);
      session.undo();
    }
    session.select(range);
    session.execute({ type: "audio.setGain", keys: keys(), gainDb: -3 });
    session.execute({ type: "audio.setTrack", key: track, muted: true });
    expect(snapshot().selection).toEqual(range);
  });

  it("selects a range on the tracks named, in plan order, and drops a track that's removed", async () => {
    const { session, snapshot, trackKeys } = setup();
    await session.open(recording(100));
    await session.insert(recording(100));
    await session.insert(recording(100));
    const [first, second, third] = trackKeys() as [string, string, string];
    // Every track by default.
    session.select({ start: 10, end: 20 });
    expect(snapshot().selection?.tracks).toEqual([first, second, third]);
    session.select({ start: 10, end: 20, tracks: [third, first, "nowhere"] });
    expect(snapshot().selection).toEqual({ start: 10, end: 20, tracks: [first, third] });
    expect(Object.isFrozen(snapshot().selection?.tracks)).toBe(true);
    // The same selection again changes nothing.
    const before = snapshot();
    session.select({ start: 10, end: 20, tracks: [first, third] });
    expect(snapshot()).toBe(before);
    session.execute({ type: "audio.removeTracks", keys: [third] });
    expect(snapshot().selection).toEqual({ start: 10, end: 20, tracks: [first] });
    session.undo();
    // It doesn't come back with the track: the selection isn't in the history.
    expect(snapshot().selection?.tracks).toEqual([first]);
    session.select({ start: 10, end: 20, tracks: ["nowhere"] });
    expect(snapshot().selection).toBeUndefined();
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
      const { session, keys, snapshot, events, ripple } = setup();
      await session.open(recording(400, 2));
      session.execute(ripple(100, 300));
      const busy: boolean[] = [];
      const unsubscribe = session.subscribe(() => busy.push(snapshot().busy));
      const exporting = session.export({ format: { container: "wav", sampleFormat: "float32" } });
      // An edit while it runs doesn't change what it renders.
      session.execute({ type: "audio.setGain", keys: keys(), gainDb: -20 });
      const result = await exporting;
      // The fake recording never goes over full scale.
      expect(result.clippedFrames).toBe(0);
      expect(result.peakDb).toBeLessThanOrEqual(0);
      const wav = await readFakeWav(result.blob);
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
      const { session, keys, events, trackKeys } = setup();
      expect(await rejection(session.export())).toMatchObject({
        code: "INVALID_COMMAND",
        details: { reason: "no-recording" },
      });
      await session.open(recording(100));
      const [track] = trackKeys();
      // A recording that's there, on a track that's silent.
      session.execute({ type: "audio.setTrack", key: track as string, muted: true });
      expect(await rejection(session.export())).toMatchObject({
        code: "INVALID_COMMAND",
        details: { reason: "nothing-audible" },
      });
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
