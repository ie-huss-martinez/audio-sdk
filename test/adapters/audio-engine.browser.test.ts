import { createAudioEngine } from "../../src/index.js";
import { describeAudioEngineContract } from "../contracts/audio-engine.contract.js";
import { wavEngineHarness } from "./engine-harness.js";

// The real engine: the inlined worker and Web Audio's AudioBuffer.
describeAudioEngineContract(
  "audio engine",
  wavEngineHarness(() => createAudioEngine()),
);
