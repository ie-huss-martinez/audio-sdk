import { createAudioEngine, isAudioError } from "@hussmartinez/audio-sdk";

/** What one run of the engine produced, for the page and the end-to-end tests. */
export interface Outcome {
  readonly status: "decoded" | string;
  readonly frames?: number;
  readonly channels?: number;
  readonly sampleRate?: number;
  readonly bound?: number;
  readonly levels?: number;
}

/** The violations of this page's Content Security Policy, if it has one. */
const violations: string[] = [];
document.addEventListener("securitypolicyviolation", (event) => {
  violations.push(`${event.violatedDirective} ${event.blockedURI}`);
});

/** Probes, decodes and builds the peaks of a file, as a host would. */
async function run(file: Blob, selfHosted: boolean): Promise<Outcome> {
  const engine = createAudioEngine(selfHosted ? { assetsUrl: "/audio-sdk/" } : {});
  try {
    const probe = await engine.probe(file);
    const audio = await engine.decode(file, probe, { signal: AbortSignal.timeout(10_000) });
    const peaks = await engine.peaks(audio);
    return {
      status: "decoded",
      frames: audio.length,
      channels: audio.numberOfChannels,
      sampleRate: audio.sampleRate,
      bound: probe.frameBound,
      levels: peaks.levels.length,
    };
  } catch (error) {
    return { status: isAudioError(error) ? error.code : "error" };
  } finally {
    await engine.destroy();
  }
}

declare global {
  interface Window {
    /** The hooks the end-to-end tests call. */
    audioSdk: {
      run(bytes: ArrayBuffer, selfHosted: boolean): Promise<Outcome>;
      readonly violations: readonly string[];
    };
  }
}

window.audioSdk = {
  run: (bytes, selfHosted) => run(new Blob([bytes]), selfHosted),
  violations,
};

const input = document.querySelector<HTMLInputElement>("#file");
const selfHostedBox = document.querySelector<HTMLInputElement>("#self-hosted");
const output = document.querySelector<HTMLOutputElement>("#result");
input?.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (!file || !output) return;
  output.value = "Working…";
  const outcome = await run(file, selfHostedBox?.checked ?? false);
  output.value =
    outcome.status === "decoded"
      ? `Decoded ${outcome.frames} frames × ${outcome.channels} channels at ${outcome.sampleRate} Hz.`
      : `Couldn't open it: ${outcome.status}.`;
});
