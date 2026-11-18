/**
 * A Server Component. It imports the server-safe entry, which must not touch
 * the browser, and renders the editor from the client entry directly, which
 * only works if its "use client" directive survived the build (ADR 0007 in
 * sdk-core).
 */
import { audioLimits } from "@hussmartinez/audio-sdk";
import { AudioEditor } from "@hussmartinez/audio-sdk/react";
import { Hydrated } from "./Hydrated";

export default function Page() {
  return (
    <main style={{ height: "100%", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)" }}>
      <h1 style={{ margin: 0, padding: "0.5rem 1rem", fontSize: "1.25rem" }}>
        Up to{" "}
        <span data-testid="max-tracks">
          {audioLimits.definitions.maxTracks.default.toLocaleString("en")}
        </span>{" "}
        tracks
      </h1>
      <AudioEditor />
      <Hydrated />
    </main>
  );
}
