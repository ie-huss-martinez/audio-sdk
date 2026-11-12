// The hooks the example page exposes (examples/vite/src/main.ts).
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
}
