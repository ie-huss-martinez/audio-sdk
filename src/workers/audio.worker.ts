// The audio worker (docs/adr/0002): probes and parses files, and builds
// waveform peaks, behind the family's worker RPC. It makes no requests.
import { exposeAudioWorker } from "../adapters/audio-worker/expose.js";

exposeAudioWorker();
