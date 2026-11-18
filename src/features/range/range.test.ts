import { describe, expect, it, vi } from "vitest";
import { singleTrack } from "../../../test/helpers/plans.js";
import { NO_FADE } from "../../core/model/plan.js";
import type { AudioSelection } from "../../core/session/session.js";
import type { AudioToolContext, AudioToolState } from "../tools/types.js";
import { deleteRange, rangeTools } from "./range.js";

const plan = singleTrack([
  {
    key: "c",
    source: "s",
    start: 0,
    end: 16_000,
    gainDb: 0,
    fadeIn: NO_FADE,
    fadeOut: NO_FADE,
  },
]);

function context(
  playhead: number,
  options: { selection?: AudioSelection; ripple?: boolean; refuse?: boolean } = {},
) {
  const state: AudioToolState = {
    plan,
    track: plan.tracks[0],
    clip: undefined,
    selection: options.selection,
    ripple: options.ripple ?? true,
    playing: false,
    canUndo: false,
    canRedo: false,
    busy: false,
    zoom: 1,
    maxZoom: 1,
  };
  return {
    state,
    playhead: () => playhead,
    select: vi.fn(),
    announce: vi.fn(),
    execute: vi.fn(() => (options.refuse ? ("empty-range" as const) : undefined)),
    seek: vi.fn(),
    focusPlayhead: vi.fn(),
    setRipple: vi.fn(),
  } as unknown as AudioToolContext & Record<string, ReturnType<typeof vi.fn>>;
}

const tool = (id: string) => rangeTools.find((each) => each.id === id) as (typeof rangeTools)[0];
const selection = (start: number, end: number): AudioSelection => ({ start, end, tracks: ["t"] });

describe("the range tools", () => {
  it("start the selection at the playhead, keeping its end, or running to the end", () => {
    const fresh = context(4_000);
    tool("audio.set-start").run(fresh);
    expect(fresh.select).toHaveBeenCalledWith({ start: 4_000, end: 16_000 });
    const kept = context(4_000, { selection: selection(2_000, 12_000) });
    tool("audio.set-start").run(kept);
    expect(kept.select).toHaveBeenCalledWith({ start: 4_000, end: 12_000, tracks: ["t"] });
    // Past the selection's end, it runs to the end of the plan.
    const past = context(14_000, { selection: selection(2_000, 12_000) });
    tool("audio.set-start").run(past);
    expect(past.select).toHaveBeenCalledWith({ start: 14_000, end: 16_000, tracks: ["t"] });
  });

  it("end the selection at the playhead, keeping its start, or from the start", () => {
    const fresh = context(4_000);
    tool("audio.set-end").run(fresh);
    expect(fresh.select).toHaveBeenCalledWith({ start: 0, end: 4_000 });
    const kept = context(10_000, { selection: selection(2_000, 12_000) });
    tool("audio.set-end").run(kept);
    expect(kept.select).toHaveBeenCalledWith({ start: 2_000, end: 10_000, tracks: ["t"] });
  });

  it("select nothing for an empty range, as at the very start or end", () => {
    const atStart = context(0);
    tool("audio.set-end").run(atStart);
    const atEnd = context(16_000);
    tool("audio.set-start").run(atEnd);
    expect(atStart.select).not.toHaveBeenCalled();
    expect(atEnd.select).not.toHaveBeenCalled();
  });

  it("clear only with a selection, and toggle Ripple", () => {
    expect(tool("audio.clear-selection").isEnabled?.(context(0).state)).toBe(false);
    const selected = context(0, { selection: selection(0, 8_000) });
    expect(tool("audio.clear-selection").isEnabled?.(selected.state)).toBe(true);
    const on = context(0);
    tool("audio.ripple").run(on);
    expect(on.setRipple).toHaveBeenCalledWith(false);
    expect(on.announce).toHaveBeenCalledWith({ key: "announce.rippleOff" });
  });
});

describe("deleteRange", () => {
  it("deletes the range from its tracks, with Ripple as set, then seeks and focuses the playhead", () => {
    const edit = context(9_000, { selection: selection(4_000, 8_000), ripple: false });
    deleteRange(edit);
    expect(edit.execute).toHaveBeenCalledWith({
      type: "audio.deleteRange",
      start: 4_000,
      end: 8_000,
      tracks: ["t"],
      ripple: false,
    });
    expect(edit.seek).toHaveBeenCalledWith(4_000);
    expect(edit.focusPlayhead).toHaveBeenCalled();
    expect(edit.announce).toHaveBeenCalledWith(
      expect.objectContaining({ key: "announce.rangeDeleted", frame: 4_000, end: 8_000 }),
    );
  });

  it("says a refusal, and leaves the playhead", () => {
    const edit = context(9_000, { selection: selection(4_000, 8_000), refuse: true });
    deleteRange(edit);
    expect(edit.announce).toHaveBeenCalledWith({ key: "announce.refused" });
    expect(edit.seek).not.toHaveBeenCalled();
  });
});
