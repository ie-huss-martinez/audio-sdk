import { describe, expect, it } from "vitest";
import { createAudioEngine, isAudioError } from "../../src/index.js";
import { describeAudioEngineContract } from "../contracts/audio-engine.contract.js";
import { wavFile } from "../fixtures/pcm-files.js";
import { wavEngineHarness } from "./engine-harness.js";

// The test server serves exactly what the build writes to dist/assets.
const ASSETS = new URL("/hm-test-assets/", location.href).href;

// The same fixtures as the inlined engine, with the worker from assetsUrl.
describeAudioEngineContract(
  "audio engine, self-hosted",
  wavEngineHarness(() => createAudioEngine({ assetsUrl: ASSETS })),
);

describe("the self-hosted worker (docs/adr/0002)", () => {
  it("refuses a worker from another version of the SDK, naming it", async () => {
    const engine = createAudioEngine({ assetsUrl: "/hm-test-assets-stale/" });
    const file = new Blob([wavFile([[0.1, 0.2]])]);
    const error = await engine.probe(file).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(isAudioError(error, "WORKER_START_FAILED")).toBe(true);
    expect(error).toHaveProperty(
      "details.asset",
      new URL("/hm-test-assets-stale/audio/audio.worker.js", location.href).href,
    );
    expect(error).toHaveProperty("details.actual", "0.0.0-stale");
    await engine.destroy();
  });

  /**
   * Runs `run(createAudioEngine, bytes)` in a same-origin frame whose Content
   * Security Policy allows workers only from 'self', with no `blob:`, and
   * reports its result and any policy violation.
   */
  async function underStrictCsp(mode: "self-hosted" | "blob worker"): Promise<{
    result: string;
    violations: string[];
  }> {
    const nonce = `hm${Math.random().toString(36).slice(2)}`;
    // The page's origin, named rather than 'self': Firefox resolves 'self' in
    // a srcdoc frame's meta policy against about:srcdoc. On a real page,
    // worker-src 'self' is this.
    const origin = location.origin;
    const sdk = new URL("../../src/index.ts", import.meta.url).href;
    const frame = document.createElement("iframe");
    frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${origin} 'nonce-${nonce}'; worker-src ${origin}; connect-src ${origin}">
<script type="module" nonce="${nonce}">
  // Vitest defines the build-time version as a global in its own frame only.
  globalThis.__AUDIO_SDK_VERSION__ = ${JSON.stringify(__AUDIO_SDK_VERSION__)};
  const violations = [];
  document.addEventListener("securitypolicyviolation", (event) => violations.push(event.violatedDirective + " " + event.blockedURI));
  window.addEventListener("message", async (event) => {
    let result;
    try {
      if (${JSON.stringify(mode)} === "blob worker") {
        // The control: a worker from a blob: URL, as the inlined mode starts.
        try {
          new Worker(URL.createObjectURL(new Blob([""], { type: "text/javascript" })));
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 300));
        result = "tried";
      } else {
        const { createAudioEngine } = await import(${JSON.stringify(sdk)});
        const engine = createAudioEngine({ assetsUrl: ${JSON.stringify(ASSETS)} });
        const file = new Blob([event.data]);
        const audio = await engine.decode(file, await engine.probe(file));
        result = "decoded " + audio.length;
        await engine.destroy();
      }
    } catch (error) {
      result = "failed " + (error && error.code ? error.code : String(error)) + " " + JSON.stringify(error && error.details) + " " + String(error && error.cause);
    }
    parent.postMessage({ result, violations }, "*");
  });
  parent.postMessage("ready", "*");
</script>`;
    const ready = new Promise<void>((resolve) => {
      const onReady = (event: MessageEvent) => {
        if (event.data === "ready") {
          window.removeEventListener("message", onReady);
          resolve();
        }
      };
      window.addEventListener("message", onReady);
    });
    document.body.append(frame);
    await ready;
    const answer = new Promise<{ result: string; violations: string[] }>((resolve) => {
      const onAnswer = (event: MessageEvent) => {
        if (event.source === frame.contentWindow && typeof event.data === "object") {
          window.removeEventListener("message", onAnswer);
          resolve(event.data);
        }
      };
      window.addEventListener("message", onAnswer);
    });
    frame.contentWindow?.postMessage(wavFile([[0.1, 0.2, 0.3, 0.4]], { format: "float32" }), "*");
    const outcome = await answer;
    frame.remove();
    return outcome;
  }

  it("works under a Content Security Policy without blob:", async () => {
    const { result, violations } = await underStrictCsp("self-hosted");
    expect(`${result} ${JSON.stringify(violations)}`).toBe("decoded 4 []");
  });

  it("is needed there: the same policy blocks blob: workers, as the inlined mode starts", async () => {
    // Vite's dev server doesn't start ?worker&inline workers from blob: URLs,
    // so the control is a blob: worker itself.
    const { violations } = await underStrictCsp("blob worker");
    expect(
      violations.some((violation) => /^worker-src blob/.test(violation)),
      String(violations),
    ).toBe(true);
  });
});
