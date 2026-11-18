import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { gainAt } from "../../core/model/envelope.js";
import { type AudioClipBody, NO_FADE } from "../../core/model/plan.js";
import { type GainEvent, gainEvents, MAX_CURVE_POINTS } from "./gain-automation.js";

const RATE = 1_000;
const clip = (changes: Partial<AudioClipBody>): AudioClipBody => ({
  key: "c",
  source: "s",
  start: 0,
  end: 100,
  gainDb: -6,
  fadeIn: NO_FADE,
  fadeOut: NO_FADE,
  ...changes,
});

/** The value the events give at a time, as Web Audio would: curves interpolated linearly. */
function valueAt(events: readonly GainEvent[], time: number): number {
  let value = Number.NaN;
  for (const event of events) {
    if (time < event.time) break;
    if (event.kind === "set") {
      value = event.value;
    } else {
      const { values, duration } = event;
      const position = Math.min(1, (time - event.time) / duration) * (values.length - 1);
      const low = Math.floor(position);
      const high = Math.min(values.length - 1, low + 1);
      value =
        (values[low] as number) +
        ((values[high] as number) - (values[low] as number)) * (position - low);
    }
  }
  return value;
}

describe("gainEvents", () => {
  it("sets a clip without fades to its gain", () => {
    expect(gainEvents(clip({}), 10, RATE)).toEqual([
      { kind: "set", time: 0, value: gainAt(clip({}), 10) },
    ]);
  });

  it("follows a fade-out curve straight from a fade-in curve that ends where it starts", () => {
    const both = clip({
      fadeIn: { frames: 50, curve: "linear" },
      fadeOut: { frames: 50, curve: "equalPower" },
    });
    const events = gainEvents(both, 0, RATE);
    expect(events.map((event) => [event.kind, event.time])).toEqual([
      ["curve", 0],
      ["curve", 0.05],
    ]);
  });

  it("starts with the fade-out curve when playing from inside it", () => {
    const events = gainEvents(clip({ fadeOut: { frames: 40, curve: "linear" } }), 70, RATE);
    expect(events.map((event) => [event.kind, event.time])).toEqual([["curve", 0]]);
  });

  it("caps a long fade's curve at the maximum points", () => {
    const long = clip({ end: 100_000, fadeIn: { frames: 50_000, curve: "linear" } });
    const [first] = gainEvents(long, 0, RATE);
    expect(first?.kind === "curve" && first.values.length).toBe(MAX_CURVE_POINTS);
  });

  it("never lets events share a time or fall inside a curve, and follows gainAt", () => {
    const curve = fc.constantFrom("linear" as const, "equalPower" as const);
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 300 }),
        fc.nat(),
        fc.nat(),
        fc.nat(),
        curve,
        curve,
        (length, a, b, from, inCurve, outCurve) => {
          const fadeIn = a % (length + 1);
          const fadeOut = b % (length - fadeIn + 1);
          const shaped = clip({
            end: length,
            fadeIn: { frames: fadeIn, curve: inCurve },
            fadeOut: { frames: fadeOut, curve: outCurve },
          });
          const start = from % length;
          const events = gainEvents(shaped, start, RATE);
          expect(events.length).toBeGreaterThan(0);
          expect(events[0]?.time).toBe(0);
          for (let i = 1; i < events.length; i += 1) {
            const previous = events[i - 1] as GainEvent;
            const end = previous.time + (previous.kind === "curve" ? previous.duration : 0);
            expect((events[i] as GainEvent).time).toBeGreaterThan(previous.time);
            expect((events[i] as GainEvent).time).toBeGreaterThanOrEqual(end);
          }
          // Short fades get a point per frame, so they're exact at every frame.
          for (let frame = start; frame < length; frame += 1) {
            expect(valueAt(events, (frame - start) / RATE)).toBeCloseTo(gainAt(shaped, frame), 5);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
