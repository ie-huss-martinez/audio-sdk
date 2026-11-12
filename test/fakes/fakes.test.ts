import { describeAudioEngineContract } from "../contracts/audio-engine.contract.js";
import { describeAudioOutputContract } from "../contracts/audio-output.contract.js";
import { describeAudioProcessorContract } from "../contracts/audio-processor.contract.js";
import { fakeEngineHarness, fakeOutputHarness, fakeProcessorHarness } from "./harness.js";

// The fakes pass the same suites as the real adapters will, which also
// proves the suites themselves. The session's tests will run against them.
describeAudioEngineContract("fake engine", fakeEngineHarness);
describeAudioProcessorContract("fake processor", fakeProcessorHarness);
describeAudioOutputContract("fake output", fakeOutputHarness);
