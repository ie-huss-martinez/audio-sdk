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
import { commandCases, planCases } from "./generate.js";
import { applyToDocument, readAndWrite } from "./run.js";

/**
 * The conformance vectors (sdk-core ADR 0045): the same files a port in
 * another language runs, checked here against the TypeScript SDK, plus the
 * rule that the runtime validators accept only what the schemas accept.
 */

const COMMANDS = new URL("../../conformance/hm-audio-commands.json", import.meta.url);
const PLANS = new URL("../../conformance/hm-audio-plan.json", import.meta.url);

const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

it("keeps the checked-in cases up to date with their generator", async () => {
  // `pnpm conformance:update` rewrites them.
  await expect(text(planCases())).toMatchFileSnapshot("../../conformance/hm-audio-plan.json");
  await expect(text(commandCases())).toMatchFileSnapshot(
    "../../conformance/hm-audio-commands.json",
  );
});

describeConformance(PLANS, readAndWrite);
describeConformance(COMMANDS, applyToDocument);

const ajv = new Ajv2020({ allErrors: true, strict: true });
const schema = (path: string) =>
  JSON.parse(readFileSync(new URL(`../../formats/${path}`, import.meta.url), "utf8")) as object;
ajv.addSchema(schema("hm-audio-plan/v1.schema.json"));
const planValid = ajv.getSchema(
  "https://github.com/ie-huss-martinez/audio-sdk/blob/main/formats/hm-audio-plan/v1.schema.json",
) as (value: unknown) => boolean;
const commandValid = ajv.compile(schema("hm-audio-command/v1.schema.json"));

/**
 * Refusals the schemas express themselves. The others, such as a clip past
 * its source or a key that's taken, depend on the plan, which a schema can't
 * see, so the schema accepts those documents and commands.
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
  "gain-out-of-range",
  "no-clips",
]);

const refusal = ({ expected }: ConformanceCase) =>
  (expected as { error?: { reason: string } }).error?.reason;

describe("the format schemas agree with the readers", () => {
  it("accept every document a reader accepts, and refuse every structural refusal", () => {
    for (const testCase of readConformance(PLANS).cases) {
      const reason = refusal(testCase);
      if (reason === undefined || !STRUCTURAL.has(reason)) {
        expect(planValid(testCase.input), testCase.name).toBe(true);
      } else {
        expect(planValid(testCase.input), testCase.name).toBe(false);
      }
    }
  });

  it("accept every command the reducer applies, and refuse every structural refusal", () => {
    for (const testCase of readConformance(COMMANDS).cases) {
      const { plan, command } = testCase.input as { plan: unknown; command: unknown };
      expect(planValid(plan), testCase.name).toBe(true);
      const reason = refusal(testCase);
      if (reason === undefined || !STRUCTURAL.has(reason)) {
        expect(commandValid(command), testCase.name).toBe(true);
      } else {
        expect(commandValid(command), testCase.name).toBe(false);
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
        planArb.chain((state) => fc.tuple(fc.constant(state), mutated(commandFor(state)))),
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
      { numRuns: 2_000 },
    );
  });

  it("never let the reader accept a document the schema refuses", () => {
    const document = planArb.map((state) => toAudioPlanDocument(state, sources));
    fc.assert(
      fc.property(
        fc.oneof(
          mutated(document),
          document.map((value) => ({
            ...value,
            clips: value.clips.map((clip, index) =>
              index === 0 ? { ...clip, gainDb: 1.5 } : clip,
            ),
          })),
        ),
        (value) => {
          let accepted = true;
          try {
            readAndWrite(value);
          } catch {
            accepted = false;
          }
          if (accepted) expect(planValid(value)).toBe(true);
        },
      ),
      { numRuns: 2_000 },
    );
  });
});
