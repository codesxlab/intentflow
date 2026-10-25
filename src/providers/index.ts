import { anthropicProvider } from "./anthropic.js";
import { mockProvider } from "./mock.js";
import { openaiProvider } from "./openai.js";
import type { Provider } from "./types.js";

export * from "./types.js";
export { anthropicProvider, DEFAULT_ANTHROPIC_MODEL, type AnthropicProviderOptions } from "./anthropic.js";
export { openaiProvider, type OpenAIProviderOptions } from "./openai.js";
export { mockProvider } from "./mock.js";

export type ProviderName = "mock" | "anthropic" | "openai";

/** Picks a provider by name, e.g. from the INTENTFLOW_PROVIDER environment variable. */
export function providerFromName(name: string | undefined): Provider {
  switch ((name ?? "mock").toLowerCase()) {
    case "mock":
      return mockProvider();
    case "anthropic":
    case "claude":
      return anthropicProvider({ model: process.env.INTENTFLOW_ANTHROPIC_MODEL });
    case "openai":
      return openaiProvider();
    default:
      throw new Error(`Unknown provider "${name}". Use one of: mock, anthropic, openai.`);
  }
}
