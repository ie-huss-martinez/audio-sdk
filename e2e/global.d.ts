// The hooks the example pages expose (examples/vite/src).
interface Window {
  audioSdk: {
    run(
      bytes: ArrayBuffer,
      selfHosted: boolean,
    ): Promise<{
      status: string;
      frames?: number;
      channels?: number;
      sampleRate?: number;
      bound?: number;
      levels?: number;
    }>;
    readonly violations: readonly string[];
  };
  /** The editor page's hooks (examples/vite/src/editor.tsx). */
  audioEditor: {
    open(bytes: ArrayBuffer): Promise<void>;
    plan(): unknown;
  };
  /** The element page's events (examples/vite/src/element.ts). */
  audioElementEvents: { name: string; json: string }[];
}
