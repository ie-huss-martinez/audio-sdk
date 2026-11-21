import { readFileSync } from "node:fs";
import {
  type ConformanceCase,
  describeConformance,
  readConformance,
} from "@hussmartinez/sdk-config/testing/conformance";
import { Ajv2020 } from "ajv/dist/2020.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { toAudioPlanDocument } from "../../src/index.js";
import { commandFor, planArb, SOURCES } from "../arbitraries/audio-plan.js";
import { commandCases, migrationCases, mixCases, planCases } from "./generate.js";
import { applyToDocument, migrateAndApply, mixPlan, readAndWrite } from "./run.js";

/**
 * The multitrack conformance vectors (docs/adr/0006, sdk-core ADR 0045):
 * the files a port in another language runs, checked here against the
 * TypeScript SDK, plus the rule that the runtime validators accept only
 * what version 2's schemas accept.
 */

const COMMANDS = new URL("../../conformance/hm-audio-commands-2.json", import.meta.url);
const PLANS = new URL("../../conformance/hm-audio-plan-2.json", import.meta.url);
const MIGRATIONS = new URL("../../conformance/hm-audio-command-migration.json", import.meta.url);
const MIXES = new URL("../../conformance/hm-audio-mix.json", import.meta.url);

/**
 * The limit of the two tests here that are over the family's 30 s when the
 * machine is busy (sdk-core ADR 0057): regenerating every checked-in case,
 * 1.8 s on an idle 12-core machine, and the schemas against the reducer on
 * thousands of generated commands, 1.6 s. At the 16 times the ADR allows
 * for, they'd take 29 and 26 s, too close to 30 s. Busy, with the whole
 * unit suite running three times at once, they took about ten times their
 * idle time. The run counts aren't lowered to fit the family's limit. The
 * other tests here take under 0.3 s, and use it.
 */
const SLOW = 120_000;

const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

it(
  "keeps the checked-in cases up to date with their generator",
  async () => {
    // `pnpm conformance:update` rewrites them.
    await expect(text(planCases())).toMatchFileSnapshot("../../conformance/hm-audio-plan-2.json");
    await expect(text(commandCases())).toMatchFileSnapshot(
      "../../conformance/hm-audio-commands-2.json",
    );
    await expect(text(migrationCases())).toMatchFileSnapshot(
      "../../conformance/hm-audio-command-migration.json",
    );
    await expect(text(mixCases())).toMatchFileSnapshot("../../conformance/hm-audio-mix.json");
    // Generating samples five thousand commands: 4.0 s alone, 40 s busy.
  },
  SLOW,
);

describeConformance(PLANS, readAndWrite);
describeConformance(COMMANDS, applyToDocument);
describeConformance(MIGRATIONS, migrateAndApply);
describeConformance(MIXES, mixPlan);

const ajv = new Ajv2020({ allErrors: true, strict: true });
const schema = (path: string) =>
  JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")) as object;
const ID = "https://github.com/ie-huss-martinez/audio-sdk/blob/main/formats/hm-audio-plan";
ajv.addSchema(schema("formats/hm-audio-plan/v1.schema.json"));
ajv.addSchema(schema("formats/hm-audio-plan/v2.schema.json"));
const valid = (id: string) => ajv.getSchema(id) as (value: unknown) => boolean;
const planV1Valid = valid(`${ID}/v1.schema.json`);
const planValid = valid(`${ID}/v2.schema.json`);
const commandValid = ajv.compile(schema("formats/hm-audio-command/v2.schema.json"));
const commandV1Valid = ajv.compile(schema("formats/hm-audio-command/v1.schema.json"));

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

  it(
    "never let the reducer apply a command the schema refuses",
    () => {
      fc.assert(
        fc.property(
          planArb.chain((state) =>
            fc.tuple(fc.constant(state), fc.oneof(commandFor(state), mutated(commandFor(state)))),
          ),
          ([state, command]) => {
            const plan = toAudioPlanDocument(state, sources);
            let applied = true;
            try {
              applyToDocument({ plan, command });
            } catch {
              applied = false;
            }
            if (applied) expect(commandValid(command)).toBe(true);
          },
        ),
        { numRuns: 3_000 },
      );
      // 2.6 s alone, 16 s busy.
    },
    SLOW / 2,
  );

  it("never let the reader accept a document the schema refuses", () => {
    const document = planArb.map((state) => toAudioPlanDocument(state, sources));
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
          readAndWrite(value);
        } catch {
          accepted = false;
        }
        if (accepted) expect(planValid(value)).toBe(true);
      }),
      { numRuns: 3_000 },
    );
    // 1.1 s alone, 2.1 s busy.
  });
});
