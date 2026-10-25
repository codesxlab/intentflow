import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { ProviderOutputError, type CompletionRequest, type Provider } from "./types.js";

export interface OpenAIProviderOptions {
  /** Defaults to `new OpenAI()`, which reads OPENAI_API_KEY. */
  client?: OpenAI;
  /** Defaults to INTENTFLOW_OPENAI_MODEL, then "gpt-5". */
  model?: string;
}

export function openaiProvider(options: OpenAIProviderOptions = {}): Provider {
  const client = options.client ?? new OpenAI();
  const model = options.model ?? process.env.INTENTFLOW_OPENAI_MODEL ?? "gpt-5";

  return {
    name: "openai",
    model,
    async complete<T>({ system, input, schema, schemaName }: CompletionRequest<T>): Promise<T> {
      const response = await client.responses.parse({
        model,
        instructions: system,
        input,
        text: { format: zodTextFormat(schema, schemaName) },
      });
      if (response.output_parsed == null) {
        throw new ProviderOutputError("The response did not contain JSON matching the schema.", "openai");
      }
      return response.output_parsed as T;
    },
  };
}
