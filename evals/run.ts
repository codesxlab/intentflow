/**
 * Runs the eval cases against a provider and reports how often it picks the right action
 * and fills the parameters a reviewer would expect, per language, with the tokens it used.
 *
 *   npm run eval                                  # mock provider, no API key
 *   npm run eval -- --provider anthropic          # needs ANTHROPIC_API_KEY
 *   npm run eval -- --provider openai --json out.json
 *   npm run eval -- --lang en --min-score 0.6     # only English cases; exit 1 below this full-match score (CI)
 *   npm run eval -- --provider openai --price-in 2.5 --price-out 10   # USD per 1M tokens → cost estimate
 *   npm run eval -- --provider openai --sample 1  # first case of each language: measure tokens cheaply
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createIntentFlow, officeActions, providerFromName, type Extraction } from "../src/index.js";

interface EvalCase {
  id: string;
  lang: string;
  input: string;
  expect: { action: string; params?: Record<string, string | boolean | null> };
}

interface CaseResult {
  id: string;
  lang: string;
  ok: boolean;
  actionOk: boolean;
  problems: string[];
  ms: number;
  /** Provider calls made for this case (more than 1 means invalid output was retried). */
  calls: number;
  inputTokens: number;
  outputTokens: number;
  output?: Extraction;
  error?: string;
}

const { values } = parseArgs({
  options: {
    provider: { type: "string", default: process.env.INTENTFLOW_PROVIDER ?? "mock" },
    lang: { type: "string" },
    json: { type: "string" },
    "min-score": { type: "string" },
    concurrency: { type: "string", default: "1" },
    sample: { type: "string" },
    "price-in": { type: "string" },
    "price-out": { type: "string" },
  },
});

const langs = values.lang?.split(",").map((l) => l.trim().toLowerCase()).filter(Boolean);
const allCases = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8")) as EvalCase[];
const selected = langs ? allCases.filter((c) => langs.includes(c.lang)) : allCases;
// --sample N: the first N cases of each language, to measure tokens cheaply before a full run.
const sample = values.sample ? Math.max(1, Number(values.sample)) : undefined;
const cases = sample
  ? selected.filter((c, i) => selected.slice(0, i).filter((p) => p.lang === c.lang).length < sample)
  : selected;
if (cases.length === 0) throw new Error(`No cases for --lang ${values.lang}.`);

const provider = providerFromName(values.provider);
const flow = createIntentFlow({ provider, actions: officeActions });
const concurrency = Math.max(1, Number(values.concurrency) || 1);

/** Strings match if the expected text appears in the actual value (case-insensitive); arrays match if any item does. */
function matches(expected: string | boolean | null, actual: unknown): boolean {
  if (expected === null || typeof expected === "boolean") return actual === expected;
  const needle = expected.toLocaleLowerCase();
  const values = Array.isArray(actual) ? actual : [actual];
  return values.some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(needle));
}

async function runCase(testCase: EvalCase): Promise<CaseResult> {
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const onUsage = ({ inputTokens, outputTokens }: { inputTokens: number; outputTokens: number }) => {
    usage.calls++;
    usage.inputTokens += inputTokens;
    usage.outputTokens += outputTokens;
  };
  const base = { id: testCase.id, lang: testCase.lang };
  const started = performance.now();
  try {
    const output = await flow.extract(testCase.input, { onUsage });
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
    return { ...base, ok: problems.length === 0, actionOk, problems, ms, ...usage, output };
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, ok: false, actionOk: false, problems: [`error: ${message}`], ms, ...usage, error: message };
  }
}

// Run with a small worker pool; results keep the order of cases.json.
const results: CaseResult[] = new Array(cases.length);
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(concurrency, cases.length) }, async () => {
    while (next < cases.length) {
      const index = next++;
      results[index] = await runCase(cases[index]!);
    }
  }),
);

const width = Math.max(...results.map((r) => r.id.length));
for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.id.padEnd(width)}  ${String(r.ms).padStart(5)} ms  ${r.problems.join("; ")}`);
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const summarize = (rows: CaseResult[]) => ({
  cases: rows.length,
  actionMatch: rows.filter((r) => r.actionOk).length / rows.length,
  fullMatch: rows.filter((r) => r.ok).length / rows.length,
});

const overall = summarize(results);
const byLang = Object.fromEntries([...new Set(results.map((r) => r.lang))].map((lang) => [lang, summarize(results.filter((r) => r.lang === lang))]));

console.log(`\nprovider: ${provider.name} (${provider.model})  cases: ${overall.cases}`);
console.log(`action accuracy: ${pct(overall.actionMatch)}   full match (action + params): ${pct(overall.fullMatch)}`);
for (const [lang, s] of Object.entries(byLang)) {
  console.log(`  ${lang}: ${String(s.cases).padStart(3)} cases  action ${pct(s.actionMatch).padStart(6)}  full ${pct(s.fullMatch).padStart(6)}`);
}

const totals = {
  calls: results.reduce((n, r) => n + r.calls, 0),
  inputTokens: results.reduce((n, r) => n + r.inputTokens, 0),
  outputTokens: results.reduce((n, r) => n + r.outputTokens, 0),
};
let costUsd: number | undefined;
if (totals.calls > 0) {
  console.log(
    `tokens: ${totals.inputTokens.toLocaleString("en")} in, ${totals.outputTokens.toLocaleString("en")} out over ${totals.calls} calls ` +
      `(per case: ${Math.round(totals.inputTokens / results.length)} in, ${Math.round(totals.outputTokens / results.length)} out)`,
  );
  if (values["price-in"] && values["price-out"]) {
    costUsd = (totals.inputTokens * Number(values["price-in"]) + totals.outputTokens * Number(values["price-out"])) / 1_000_000;
    console.log(`estimated cost: $${costUsd.toFixed(4)} (at $${values["price-in"]} in / $${values["price-out"]} out per 1M tokens)`);
  }
}

if (values.json) {
  const report = {
    date: new Date().toISOString(),
    provider: provider.name,
    model: provider.model,
    langs: langs ?? Object.keys(byLang),
    ...overall,
    byLang,
    usage: totals,
    ...(costUsd !== undefined ? { costUsd, pricePerMTokens: { input: Number(values["price-in"]), output: Number(values["price-out"]) } } : {}),
    results,
  };
  writeFileSync(values.json, JSON.stringify(report, null, 2));
  console.log(`wrote ${values.json}`);
}

const minScore = values["min-score"] ? Number(values["min-score"]) : undefined;
if (minScore !== undefined && overall.fullMatch < minScore) {
  console.error(`full match ${pct(overall.fullMatch)} is below --min-score ${pct(minScore)}`);
  process.exit(1);
}
