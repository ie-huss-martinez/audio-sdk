import type { AudioEngine } from "../core/ports/audio-engine.js";
import type { AudioOutput } from "../core/ports/audio-output.js";
import type { AudioProcessor } from "../core/ports/audio-processor.js";
import { createAudioEngine } from "./audio-engine.js";
import { createAudioOutput } from "./audio-output.js";
import { createAudioProcessor } from "./audio-processor.js";

/**
 * Options for {@link createAudioAdapters}.
 *
 * @public
 */
export interface AudioAdaptersOptions {
  /**
   * Where the application serves the package's `dist/assets/` directory, for
   * the engine's and the processor's worker alike (docs/adr/0002). By
   * default the worker is inlined.
   */
  readonly assetsUrl?: string | URL;
  /** Milliseconds without calls after which each worker stops. Defaults to sdk-core's 30 seconds. */
  readonly idleTimeout?: number;
}

/**
 * The SDK's own adapters, made together: what a session and its playback
 * need. You own them: the session never destroys what it's given, so call
 * {@link AudioAdapters.destroy} after closing the session.
 *
 * @public
 */
export interface AudioAdapters {
  readonly engine: AudioEngine;
  readonly processor: AudioProcessor;
  readonly output: AudioOutput;
  /** Destroys the engine, the processor and the output, waiting for each. */
  destroy(): Promise<void>;
}

/**
 * Creates the SDK's engine, processor and output with one set of options,
 * so a self-hosted worker's `assetsUrl` is given once (docs/adr/0006).
 * Nothing starts until it's used: no worker, and no `AudioContext` until
 * the first `play()`.
 *
 * @example
 * ```ts
 * const adapters = createAudioAdapters({ assetsUrl: "/audio-sdk/" });
 * const session = createAudioSession({ engine: adapters.engine, processor: adapters.processor });
 * const disconnect = connectOutput(session, adapters.output);
 * // …
 * disconnect();
 * await session.close();
 * await adapters.destroy();
 * ```
 *
 * @public
 */
export function createAudioAdapters(options: AudioAdaptersOptions = {}): AudioAdapters {
  const worker = {
    ...(options.assetsUrl === undefined ? {} : { assetsUrl: options.assetsUrl }),
    ...(options.idleTimeout === undefined ? {} : { idleTimeout: options.idleTimeout }),
  };
  const engine = createAudioEngine(worker);
  const processor = createAudioProcessor(worker);
  const output = createAudioOutput();
  return {
    engine,
    processor,
    output,
    async destroy() {
      await Promise.all([engine.destroy(), processor.destroy(), output.destroy()]);
    },
  };
}
