/**
 * How a source's channels mix into the plan's, as Web Audio's `speakers`
 * channel interpretation does, so that playback and export agree
 * (docs/adr/0003). Mono, stereo, quad (L, R, SL, SR) and 5.1 (L, R, C, LFE,
 * SL, SR) mix by the Web Audio specification's up-mix and down-mix rules;
 * any other pair of counts mixes discretely: channel by channel, with extra
 * outputs silent and extra inputs dropped.
 *
 * The result is a matrix: `matrix[output][input]` is the weight of input
 * channel `input` in output channel `output`.
 *
 * @see https://webaudio.github.io/web-audio-api/#channel-up-mixing-and-down-mixing
 * @internal
 */
export function channelMix(from: number, to: number): readonly (readonly number[])[] {
  const matrix = Array.from({ length: to }, () => new Array<number>(from).fill(0));
  const set = (output: number, input: number, weight: number) => {
    (matrix[output] as number[])[input] = weight;
  };
  const half = Math.SQRT1_2;
  const key = `${from}>${to}`;
  switch (key) {
    // Up-mixing.
    case "1>2":
      set(0, 0, 1);
      set(1, 0, 1);
      break;
    case "1>4":
      set(0, 0, 1);
      set(1, 0, 1);
      break;
    case "1>6":
      set(2, 0, 1);
      break;
    case "2>4":
    case "2>6":
      set(0, 0, 1);
      set(1, 1, 1);
      break;
    case "4>6":
      set(0, 0, 1);
      set(1, 1, 1);
      set(4, 2, 1);
      set(5, 3, 1);
      break;
    // Down-mixing.
    case "2>1":
      set(0, 0, 0.5);
      set(0, 1, 0.5);
      break;
    case "4>1":
      for (let input = 0; input < 4; input += 1) set(0, input, 0.25);
      break;
    case "6>1":
      set(0, 0, half);
      set(0, 1, half);
      set(0, 2, 1);
      set(0, 4, 0.5);
      set(0, 5, 0.5);
      break;
    case "4>2":
      set(0, 0, 0.5);
      set(0, 2, 0.5);
      set(1, 1, 0.5);
      set(1, 3, 0.5);
      break;
    case "6>2":
      set(0, 0, 1);
      set(0, 2, half);
      set(0, 4, half);
      set(1, 1, 1);
      set(1, 2, half);
      set(1, 5, half);
      break;
    case "6>4":
      set(0, 0, 1);
      set(0, 2, half);
      set(1, 1, 1);
      set(1, 2, half);
      set(2, 4, 1);
      set(3, 5, 1);
      break;
    default:
      // The same count, or a pair the speaker rules don't cover: discrete.
      for (let channel = 0; channel < Math.min(from, to); channel += 1) set(channel, channel, 1);
  }
  return matrix;
}
