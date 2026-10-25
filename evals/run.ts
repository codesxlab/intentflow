/**
 * Runs the eval cases against a provider and reports how often it picks the right action
 * and fills the parameters a reviewer would expect.
 *
 *   npm run eval                                  # mock provider, no API key
 *   npm run eval -- --provider anthropic          # needs ANTHROPIC_API_KEY
 *   npm run eval -- --provider openai --json out.json
 *   npm run eval -- --min-score 0.6               # exit 1 below this full-match score (used in CI)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createIntentFlow, officeActions, providerFromName, type Extraction } from "../src/index.js";

interface EvalCase {
  id: string;
  input: string;
  expect: { action: string; params?: Record<string, string | boolean | null> };
}

interface CaseResult {
  id: string;
  ok: boolean;
  actionOk: boolean;
  problems: string[];
  ms: number;
  output?: Extraction;
  error?: string;
}

const { values } = parseArgs({
  options: {
    provider: { type: "string", default: process.env.INTENTFLOW_PROVIDER ?? "mock" },
    json: { type: "string" },
    "min-score": { type: "string" },
  },
});

const cases = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8")) as EvalCase[];
const provider = providerFromName(values.provider);
const flow = createIntentFlow({ provider, actions: officeActions });

/** Strings match if the expected text appears in the actual value (case-insensitive); arrays match if any item does. */
function matches(expected: string | boolean | null, actual: unknown): boolean {
  if (expected === null || typeof expected === "boolean") return actual === expected;
  const needle = expected.toLowerCase();
  const values = Array.isArray(actual) ? actual : [actual];
  return values.some((value) => typeof value === "string" && value.toLowerCase().includes(needle));
}

const results: CaseResult[] = [];
for (const testCase of cases) {
  const started = performance.now();
  try {
    const output = await flow.extract(testCase.input);
    const ms = Math.round(performance.now() - started);
    const actual = output.kind === "action" ? output.action : "none";
    const actionOk = actual === testCase.expect.action;
    const problems: string[] = [];
    if (!actionOk) problems.push(`action: expected ${testCase.expect.action}, got ${actual}`);
    if (actionOk && output.kind === "action") {
      for (const [key, expected] of Object.entries(testCase.expect.params ?? {})) {
        if (!matches(expected, output.params[key])) {
          problems.push(`${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(output.params[key])}`);
        }
      }
    }
    results.push({ id: testCase.id, ok: problems.length === 0, actionOk, problems, ms, output });
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    const message = error instanceof Error ? error.message : String(error);
    results.push({ id: testCase.id, ok: false, actionOk: false, problems: [`error: ${message}`], ms, error: message });
  }
}

const width = Math.max(...results.map((r) => r.id.length));
for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.id.padEnd(width)}  ${String(r.ms).padStart(5)} ms  ${r.problems.join("; ")}`);
}

const total = results.length;
const fullMatch = results.filter((r) => r.ok).length / total;
const actionMatch = results.filter((r) => r.actionOk).length / total;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
console.log(`\nprovider: ${provider.name} (${provider.model})  cases: ${total}`);
console.log(`action accuracy: ${pct(actionMatch)}   full match (action + params): ${pct(fullMatch)}`);

if (values.json) {
  writeFileSync(values.json, JSON.stringify({ provider: provider.name, model: provider.model, actionMatch, fullMatch, results }, null, 2));
  console.log(`wrote ${values.json}`);
}

const minScore = values["min-score"] ? Number(values["min-score"]) : undefined;
if (minScore !== undefined && fullMatch < minScore) {
  console.error(`full match ${pct(fullMatch)} is below --min-score ${pct(minScore)}`);
  process.exit(1);
}
