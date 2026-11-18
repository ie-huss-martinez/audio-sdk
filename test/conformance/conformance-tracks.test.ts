import { readFileSync } from "node:fs";
import {
  type ConformanceCase,
  describeConformance,
  readConformance,
} from "@hussmartinez/sdk-config/testing/conformance";
import { Ajv2020 } from "ajv/dist/2020.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { toTrackPlanDocument } from "../../src/core/format/track-plan-document.js";
import { SOURCES, trackCommandFor, trackPlanArb } from "../arbitraries/track-plan.js";
import { migrationCases, trackCommandCases, trackPlanCases } from "./generate-tracks.js";
import { applyToTracks, migrateAndApply, readAndWriteTracks } from "./run-tracks.js";

/**
 * The multitrack conformance vectors (docs/adr/0006, sdk-core ADR 0045):
 * the files a port in another language runs, checked here against the
 * TypeScript SDK, plus the rule that the runtime validators accept only
 * what version 2's schemas accept.
 */

const COMMANDS = new URL("../../conformance/hm-audio-commands-2.json", import.meta.url);
const PLANS = new URL("../../conformance/hm-audio-plan-2.json", import.meta.url);
const MIGRATIONS = new URL("../../conformance/hm-audio-command-migration.json", import.meta.url);

const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

it("keeps the checked-in cases up to date with their generator", async () => {
  // `pnpm conformance:update` rewrites them.
  await expect(text(trackPlanCases())).toMatchFileSnapshot(
    "../../conformance/hm-audio-plan-2.json",
  );
  await expect(text(trackCommandCases())).toMatchFileSnapshot(
    "../../conformance/hm-audio-commands-2.json",
  );
  await expect(text(migrationCases())).toMatchFileSnapshot(
    "../../conformance/hm-audio-command-migration.json",
  );
  // Generating samples a few thousand commands, which is slow beside the other suites.
}, 30_000);

describeConformance(PLANS, readAndWriteTracks);
describeConformance(COMMANDS, applyToTracks);
describeConformance(MIGRATIONS, migrateAndApply);

const ajv = new Ajv2020({ allErrors: true, strict: true });
const schema = (path: string) =>
  JSON.parse(readFileSync(new URL(`../../formats/${path}`, import.meta.url), "utf8")) as object;
const ID = "https://github.com/ie-huss-martinez/audio-sdk/blob/main/formats/hm-audio-plan";
ajv.addSchema(schema("hm-audio-plan/v1.schema.json"));
ajv.addSchema(schema("hm-audio-plan/v2.schema.json"));
const valid = (id: string) => ajv.getSchema(id) as (value: unknown) => boolean;
const planV1Valid = valid(`${ID}/v1.schema.json`);
const planValid = valid(`${ID}/v2.schema.json`);
const commandValid = ajv.compile(schema("hm-audio-command/v2.schema.json"));
const commandV1Valid = ajv.compile(schema("hm-audio-command/v1.schema.json"));

/**
 * Refusals the schemas express themselves. The others depend on the plan,
 * or on two fields together, which a schema can't see, so the schema
 * accepts those documents and commands.
 */
const STRUCTURAL = new Set([
  "malformed-command",
  "malformed-document",
  "unknown-command",
  "unknown-format",
  "unknown-format-version",
  "invalid-fade-curve",
  "invalid-edge",
  "invalid-frames",
  "unknown-metadata-field",
  "metadata-too-long",
  "name-too-long",
  "gain-out-of-range",
  "no-clips",
  "no-tracks",
  "empty-change",
]);

const refusal = ({ expected }: ConformanceCase) =>
  (expected as { error?: { reason: string } }).error?.reason;

describe("version 2's schemas agree with the readers", () => {
  it("accept every document a reader accepts, and refuse every structural refusal", () => {
    for (const testCase of readConformance(PLANS).cases) {
      const reason = refusal(testCase);
      const { version } = testCase.input as { version?: unknown };
      // A version 1 document is checked by version 1's schema.
      const check = version === 1 ? planV1Valid : planValid;
      expect(check(testCase.input), testCase.name).toBe(
        reason === undefined || !STRUCTURAL.has(reason),
      );
    }
  });

  it("accept every command the reducer applies, and refuse every structural refusal", () => {
    for (const testCase of readConformance(COMMANDS).cases) {
      const { plan, command } = testCase.input as { plan: unknown; command: unknown };
      expect(planValid(plan), testCase.name).toBe(true);
      const reason = refusal(testCase);
      expect(commandValid(command), testCase.name).toBe(
        reason === undefined || !STRUCTURAL.has(reason),
      );
    }
  });

  it("take version 1's plans and commands as the migration's input", () => {
    for (const testCase of readConformance(MIGRATIONS).cases) {
      const { plan, command } = testCase.input as { plan: unknown; command: unknown };
      expect(planV1Valid(plan), testCase.name).toBe(true);
      const reason = refusal(testCase);
      if (reason === undefined) {
        expect(commandV1Valid(command), testCase.name).toBe(true);
        expect(planValid(testCase.expected), testCase.name).toBe(true);
      }
    }
  });

  /** A value with one field replaced by any JSON value, or one added. */
  const mutated = <T extends object>(value: fc.Arbitrary<T>) =>
    fc
      .tuple(value, fc.nat(), fc.string(), fc.jsonValue({ maxDepth: 2 }), fc.boolean())
      .map(([original, index, name, replacement, add]) => {
        const copy: Record<string, unknown> = JSON.parse(JSON.stringify(original));
        const fields = Object.keys(copy);
        const field = add || fields.length === 0 ? name : (fields[index % fields.length] as string);
        // An own property, as JSON.parse makes even for "__proto__".
        Object.defineProperty(copy, field, {
          value: replacement,
          enumerable: true,
          writable: true,
          configurable: true,
        });
        return copy;
      });

  const sources = Object.fromEntries(
    Object.entries(SOURCES).map(([id, frames]) => [id, { frames }]),
  );

  it("never let the reducer apply a command the schema refuses", () => {
    fc.assert(
      fc.property(
        trackPlanArb.chain((state) =>
          fc.tuple(
            fc.constant(state),
            fc.oneof(trackCommandFor(state), mutated(trackCommandFor(state))),
          ),
        ),
        ([state, command]) => {
          const plan = toTrackPlanDocument(state, sources);
          let applied = true;
          try {
            applyToTracks({ plan, command });
          } catch {
            applied = false;
          }
          if (applied) expect(commandValid(command)).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("never let the reader accept a document the schema refuses", () => {
    const document = trackPlanArb.map((state) => toTrackPlanDocument(state, sources));
    /** One of the first track's fields, or its first clip's, replaced. */
    const deeper = fc
      .tuple(document, fc.jsonValue({ maxDepth: 1 }), fc.string(), fc.boolean())
      .map(([value, replacement, name, inClip]) => {
        const copy = JSON.parse(JSON.stringify(value)) as { tracks: Record<string, unknown>[] };
        const [first] = copy.tracks;
        const [clip] = (first?.["clips"] ?? []) as Record<string, unknown>[];
        const target = inClip && clip ? clip : first;
        if (target) {
          Object.defineProperty(target, name, {
            value: replacement,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
        return copy;
      });
    fc.assert(
      fc.property(fc.oneof(mutated(document), deeper), (value) => {
        let accepted = true;
        try {
          readAndWriteTracks(value);
        } catch {
          accepted = false;
        }
        if (accepted) expect(planValid(value)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});
