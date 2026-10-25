import { readFileSync } from "node:fs";
import type { Extraction } from "../src/index.js";
import { ProviderOutputError, type CompletionRequest, type Provider } from "../src/index.js";

interface RecordedReport {
  date: string;
  model: string;
  results: { id: string; output?: Extraction }[];
}

/**
 * Replays the model outputs recorded in a published eval report, without calling any API.
 * Use it to measure pipeline changes (validation, detail checks) on real outputs for free.
 * The prompt is not replayed: outputs are what the model returned with the prompt of that run.
 */
export function replayProvider(reportPath: string, cases: { id: string; input: string }[]): Provider {
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as RecordedReport;
  const inputs = new Map(cases.map((c) => [c.id, c.input.trim()]));
  const outputs = new Map<string, Extraction>();
  for (const result of report.results) {
    const input = inputs.get(result.id);
    if (input !== undefined && result.output) outputs.set(input, result.output);
  }

  return {
    name: "replay",
    model: `${report.model} (recorded ${report.date.slice(0, 10)})`,
    async complete<T>({ input }: CompletionRequest<T>): Promise<T> {
      const output = outputs.get(input.trim());
      if (!output) throw new ProviderOutputError("No recorded output for this request.", "replay");
      return { result: output } as T;
    },
  };
}
