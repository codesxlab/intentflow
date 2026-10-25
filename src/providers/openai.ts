import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { ProviderOutputError, type CompletionRequest, type Provider } from "./types.js";

export interface OpenAIProviderOptions {
  /** Defaults to `new OpenAI()`, which reads OPENAI_API_KEY. */
  client?: OpenAI;
  /** Defaults to INTENTFLOW_OPENAI_MODEL, then "gpt-6-astra" (OpenAI's recommended default as of Oct 2026). */
  model?: string;
}

export const DEFAULT_OPENAI_MODEL = "gpt-6-astra";

export function openaiProvider(options: OpenAIProviderOptions = {}): Provider {
  const client = options.client ?? new OpenAI();
  const model = options.model ?? process.env.INTENTFLOW_OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;

  return {
    name: "openai",
    model,
    async complete<T>({ system, input, schema, schemaName, onUsage }: CompletionRequest<T>): Promise<T> {
      const response = await client.responses.parse({
        model,
        instructions: system,
        input,
        text: { format: zodTextFormat(schema, schemaName) },
      });
      if (response.usage) {
        onUsage?.({ inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });
      }
      if (response.output_parsed == null) {
        throw new ProviderOutputError("The response did not contain JSON matching the schema.", "openai");
      }
      return response.output_parsed as T;
    },
  };
}
