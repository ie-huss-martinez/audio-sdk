import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AudioEditor } from "./AudioEditor.js";
import { useAudioMessages, useAudioOutput, useAudioPlayhead, useAudioSession } from "./context.js";

/** Calls one hook, outside any provider. */
function Probe({ hook }: { readonly hook: () => unknown }) {
  hook();
  return null;
}

describe("the editor on a server (sdk-core ADR 0007)", () => {
  it("renders its empty state, with no worker, AudioContext or style attribute", () => {
    // A relative assetsUrl can't resolve without a page: it's ignored here.
    const html = renderToString(<AudioEditor assetsUrl="/audio-sdk/" theme="dark" />);
    expect(html).toContain('aria-label="Audio editor"');
    expect(html).toContain('class="hm-text hm-audio-editor"');
    expect(html).toContain('data-hm-theme="dark"');
    expect(html).toContain("data-hm-empty");
    expect(html).toContain("Drop an audio file here, or choose one.");
    expect(html).toContain('aria-label="Playback"');
    expect(html).toContain("0:00.00 / 0:00.00");
    // A strict Content Security Policy blocks style attributes (sdk-core ADR 0012).
    expect(html).not.toMatch(/\sstyle="/);
    expect(typeof (globalThis as { AudioContext?: unknown }).AudioContext).toBe("undefined");
  });

  it("leaves out its own look when unstyled", () => {
    const html = renderToString(
      <AudioEditor unstyled className="mine" classNames={{ root: "root" }} />,
    );
    expect(html).toContain('class="hm-audio-editor mine root"');
    expect(html).toContain("data-hm-unstyled");
  });

  it("takes the host's text and locale", () => {
    const html = renderToString(
      <AudioEditor locale="de" messages={{ "editor.label": "Audio-Editor" }} />,
    );
    expect(html).toContain('aria-label="Audio-Editor"');
  });

  it("refuses hooks outside the provider, naming it", () => {
    for (const hook of [useAudioSession, useAudioOutput, useAudioPlayhead, useAudioMessages]) {
      expect(() => renderToString(<Probe hook={hook} />)).toThrow(
        "Audio editor components need an AudioEditorProvider.",
      );
    }
  });
});
