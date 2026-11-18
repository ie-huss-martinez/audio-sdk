/**
 * Sample-rate conversion with a windowed sinc (docs/adr/0006): band-limited
 * interpolation, so that a source at another rate keeps its pitch and length
 * in the session, without the aliasing that picking or averaging samples
 * leaves.
 *
 * It runs in the worker, block by block. It's our own, not Web Audio's,
 * because the browsers' resamplers differ from each other, can't report
 * progress and can't be cancelled; this one gives the same samples in every
 * engine, whatever the blocks.
 */

/** Zero crossings of the sinc on each side of its centre. More is sharper and slower. */
const ZERO_CROSSINGS = 16;

/** Table entries per zero crossing. The filter is read between them linearly. */
const TABLE_RESOLUTION = 512;

/** The Kaiser window's shape: about 90 dB of stop-band attenuation. */
const KAISER_BETA = 9;

/**
 * How much of the band below the lower Nyquist frequency passes: the rest is
 * the filter's transition, kept below Nyquist so nothing aliases.
 */
const PASS_BAND = 0.945;

/** The zeroth-order modified Bessel function of the first kind, by its power series. */
function bessel0(x: number): number {
  let sum = 1;
  let term = 1;
  const quarter = (x * x) / 4;
  for (let k = 1; term > sum * 1e-17; k += 1) {
    term *= quarter / (k * k);
    sum += term;
  }
  return sum;
}

let table: Float64Array | undefined;

/**
 * The windowed sinc from its centre to its last zero crossing, in units of
 * zero crossings, so one table serves every pair of rates.
 */
function filterTable(): Float64Array {
  if (table) return table;
  const size = ZERO_CROSSINGS * TABLE_RESOLUTION;
  // One entry past the end, zero, so reading between entries never overruns.
  const built = new Float64Array(size + 2);
  const scale = bessel0(KAISER_BETA);
  for (let i = 0; i <= size; i += 1) {
    const u = i / TABLE_RESOLUTION;
    const sinc = i === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u);
    const position = u / ZERO_CROSSINGS;
    const window = bessel0(KAISER_BETA * Math.sqrt(Math.max(0, 1 - position * position))) / scale;
    built[i] = sinc * window;
  }
  built[size] = 0;
  table = built;
  return built;
}

/** Whether a value is a whole number of at least `least`. */
const isWhole = (value: number, least: number) => Number.isSafeInteger(value) && value >= least;

/**
 * How many frames `frames` at `fromRate` become at `toRate`: enough to cover
 * the same time, rounded up.
 *
 * @internal
 */
export function resampledLength(frames: number, fromRate: number, toRate: number): number {
  const length = Math.ceil((frames * toRate) / fromRate);
  if (!isWhole(frames, 0) || !isWhole(fromRate, 1) || !isWhole(toRate, 1) || !isWhole(length, 0)) {
    throw new RangeError("Frames and rates must be whole numbers, and rates positive.");
  }
  return length;
}

/**
 * How many input frames the filter reads on each side of an output frame's
 * position.
 *
 * @internal
 */
export function resampleReach(fromRate: number, toRate: number): number {
  return Math.ceil(ZERO_CROSSINGS / (Math.min(1, toRate / fromRate) * PASS_BAND));
}

/**
 * One block of a conversion: which output frames to compute, and the input
 * they need.
 *
 * @internal
 */
export interface ResampleBlockInput {
  /** The input samples of one channel, from the input frame `inputStart`. */
  readonly input: Float32Array;
  /** The input frame `input` begins at. Frames outside `input` count as silence. */
  readonly inputStart: number;
  readonly fromRate: number;
  readonly toRate: number;
  /** The first output frame to compute. */
  readonly start: number;
  /** How many output frames to compute. */
  readonly frames: number;
}

/**
 * Computes a run of output frames of one channel. Each frame depends only
 * on its own index and the input around it, so the result doesn't depend on
 * how the output is cut into blocks. Pass at least the input within
 * {@link resampleReach} of the frames' positions; frames outside `input` are
 * silence, as before the recording's start and after its end.
 *
 * @internal
 */
export function resampleBlock(block: ResampleBlockInput): Float32Array<ArrayBuffer> {
  const { input, inputStart, fromRate, toRate, start, frames } = block;
  if (
    !isWhole(fromRate, 1) ||
    !isWhole(toRate, 1) ||
    !isWhole(start, 0) ||
    !isWhole(frames, 0) ||
    !isWhole(inputStart, 0) ||
    !Number.isSafeInteger((start + frames) * fromRate)
  ) {
    throw new RangeError("Rates and positions must be whole numbers, and rates positive.");
  }
  const filter = filterTable();
  // Below 1 when the rate falls: the filter widens to cut what the lower
  // rate can't carry.
  const cutoff = Math.min(1, toRate / fromRate) * PASS_BAND;
  const reach = resampleReach(fromRate, toRate);
  const step = cutoff * TABLE_RESOLUTION;
  const taps = 2 * reach;
  const output = new Float32Array(frames);
  const available = input.length;

  // An output frame's place between two input frames is one of a few
  // phases, toRate / gcd of them, such as 160 from 44.1 to 48 kHz. Each
  // phase's weights are worked out once, the first time a frame needs them.
  const phases = toRate / gcd(fromRate, toRate);
  const phaseStep = toRate / phases;
  const rows: (Float64Array | undefined)[] = [];

  /** The weights of the input frames around a position, for one phase. They sum to 1. */
  const weightsOf = (phase: number): Float64Array => {
    const row = new Float64Array(taps);
    const fraction = phase / phases;
    let total = 0;
    for (let tap = 0; tap < taps; tap += 1) {
      // The tap's input frame is `tap - reach + 1` frames from the position's whole frame.
      const at = Math.abs(fraction - (tap - reach + 1)) * step;
      const index = Math.floor(at);
      if (index >= filter.length - 1) continue;
      const low = filter[index] as number;
      const weight = low + ((filter[index + 1] as number) - low) * (at - index);
      row[tap] = weight;
      total += weight;
    }
    // Every tap counts towards the gain, over silence or not, so a steady
    // signal keeps its level and the ends fade into the silence around them.
    for (let tap = 0; tap < taps; tap += 1) row[tap] = (row[tap] as number) / total;
    return row;
  };

  for (let n = 0; n < frames; n += 1) {
    // The output frame's position in the input, as a whole frame and a
    // remainder, in whole numbers so that it's exact.
    const scaled = (start + n) * fromRate;
    const whole = Math.floor(scaled / toRate);
    const phase = (scaled - whole * toRate) / phaseStep;
    let row = rows[phase];
    if (!row) {
      row = weightsOf(phase);
      rows[phase] = row;
    }
    // The first tap's input frame, as an index into `input`.
    const base = whole - reach + 1 - inputStart;
    const from = Math.max(0, -base);
    const to = Math.min(taps, available - base);
    let sum = 0;
    for (let tap = from; tap < to; tap += 1) {
      sum += (input[base + tap] as number) * (row[tap] as number);
    }
    output[n] = sum;
  }
  return output;
}

/** The greatest common divisor of two positive whole numbers. */
function gcd(a: number, b: number): number {
  let [x, y] = [a, b];
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}
