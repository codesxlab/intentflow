import type { z } from "zod";

export interface ActionSummary {
  name: string;
  description: string;
}

export interface CompletionRequest<T> {
  /** Instructions for the model. */
  system: string;
  /** The incoming request, as received. */
  input: string;
  /** The schema the output must satisfy. */
  schema: z.ZodType<T>;
  /** A short identifier for the schema (some APIs require one). */
  schemaName: string;
  /** The action catalog; also present in `system`, exposed for providers that don't call a model. */
  actions: readonly ActionSummary[];
}

/** Anything that can turn a request into schema-shaped output: a hosted LLM, a local model, or a rule set. */
export interface Provider {
  readonly name: string;
  readonly model: string;
  complete<T>(request: CompletionRequest<T>): Promise<T>;
}

/** The provider answered, but the output was missing, truncated, or did not match the schema. Retryable. */
export class ProviderOutputError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ProviderOutputError";
  }
}

/** The model declined the request. Not retried: the same input would be declined again. */
export class ProviderRefusalError extends Error {
  constructor(
    message: string,
    readonly provider: string,
  ) {
    super(message);
    this.name = "ProviderRefusalError";
  }
}
