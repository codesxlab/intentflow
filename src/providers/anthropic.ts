import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ProviderOutputError, ProviderRefusalError, type CompletionRequest, type Provider } from "./types.js";

export interface AnthropicProviderOptions {
  /** Defaults to `new Anthropic()`, which reads ANTHROPIC_API_KEY (or an `ant auth login` profile). */
  client?: Anthropic;
  /** Defaults to "claude-opus-5-5". */
  model?: string;
  /** Reasoning effort. Extraction is a focused task, so "medium" is the default. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
  /**
   * If the primary model declines a request, let the API retry it on a fallback model it picks
   * (`fallbacks: "default"`). On by default; set to false on platforms without server-side fallbacks.
   */
  refusalFallback?: boolean;
}

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

export function anthropicProvider(options: AnthropicProviderOptions = {}): Provider {
  const client = options.client ?? new Anthropic();
  const model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
  const refusalFallback = options.refusalFallback ?? true;

  return {
    name: "anthropic",
    model,
    async complete<T>({ system, input, schema }: CompletionRequest<T>): Promise<T> {
      const response = await client.beta.messages.parse({
        model,
        max_tokens: options.maxTokens ?? 16000,
        system,
        messages: [{ role: "user", content: input }],
        output_config: {
          effort: options.effort ?? "medium",
          format: betaZodOutputFormat(schema),
        },
        ...(refusalFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });

      if (response.stop_reason === "refusal") {
        const reason = response.stop_details?.explanation ?? "The model declined this request.";
        throw new ProviderRefusalError(reason, "anthropic");
      }
      if (response.stop_reason === "max_tokens") {
        throw new ProviderOutputError("The response hit max_tokens before the JSON was complete.", "anthropic");
      }
      if (response.parsed_output == null) {
        throw new ProviderOutputError("The response did not contain JSON matching the schema.", "anthropic");
      }
      return response.parsed_output as T;
    },
  };
}
