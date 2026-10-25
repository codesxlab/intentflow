import type { ActionCatalog } from "./actions.js";
import { buildSystemPrompt } from "./prompt.js";
import { buildResultSchema, type Extraction } from "./schema.js";
import { ProviderOutputError, type Provider, type TokenUsage } from "./providers/types.js";

export interface IntentFlowOptions {
  provider: Provider;
  actions: ActionCatalog;
  /** How many times to ask again when the output is missing or invalid. Default 2 attempts in total. */
  maxAttempts?: number;
}

export interface ExtractOptions {
  /** Called after every provider call, retries included, with the tokens it used. */
  onUsage?: (usage: TokenUsage) => void;
}

export interface IntentFlow {
  readonly provider: Provider;
  readonly actions: ActionCatalog;
  /** Turns one request into a validated proposal (or "none"). Never executes anything. */
  extract(input: string, options?: ExtractOptions): Promise<Extraction>;
}

export const MAX_INPUT_LENGTH = 8000;

export function createIntentFlow({ provider, actions, maxAttempts = 2 }: IntentFlowOptions): IntentFlow {
  const schema = buildResultSchema(actions);
  const system = buildSystemPrompt(actions);
  const summaries = actions.map(({ name, description }) => ({ name, description }));

  return {
    provider,
    actions,
    async extract(input: string, { onUsage }: ExtractOptions = {}): Promise<Extraction> {
      const text = input.trim();
      if (!text) throw new Error("The request is empty.");
      if (text.length > MAX_INPUT_LENGTH) {
        throw new Error(`The request is longer than ${MAX_INPUT_LENGTH} characters.`);
      }

      let lastError: unknown;
      for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt++) {
        try {
          const output = await provider.complete({ system, input: text, schema, schemaName: "intent_proposal", actions: summaries, onUsage });
          // Validate again here: providers are pluggable, and a custom one may skip validation.
          const checked = schema.safeParse(output);
          if (checked.success) return checked.data.result;
          lastError = new ProviderOutputError("Provider output did not match the schema.", provider.name, { cause: checked.error });
        } catch (error) {
          if (!(error instanceof ProviderOutputError)) throw error;
          lastError = error;
        }
      }
      throw lastError;
    },
  };
}
