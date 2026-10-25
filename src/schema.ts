import { z } from "zod";
import type { ActionCatalog } from "./actions.js";

export type ActionExtraction = {
  kind: "action";
  action: string;
  params: Record<string, unknown>;
  summary: string;
};

export type NoActionExtraction = {
  kind: "none";
  reason: string;
};

export type Extraction = ActionExtraction | NoActionExtraction;

/** The model's output is wrapped in an object because strict JSON-schema modes require an object root. */
export type ExtractionEnvelope = { result: Extraction };

/**
 * Builds the schema the model must follow: exactly one action from the catalog, or "none".
 * The discriminators are single-value enums. OpenAI enforces them as JSON-schema `enum`; Anthropic's
 * SDK helper passes them to the model as a description hint instead. Either way, `createIntentFlow`
 * re-validates every output with zod and asks again if it does not match.
 */
export function buildResultSchema(actions: ActionCatalog): z.ZodType<ExtractionEnvelope> {
  if (actions.length === 0) {
    throw new Error("The action catalog is empty.");
  }
  const names = new Set<string>();
  for (const action of actions) {
    if (names.has(action.name)) throw new Error(`Duplicate action name "${action.name}".`);
    names.add(action.name);
  }

  const none = z.object({
    kind: z.enum(["none"]),
    reason: z.string().describe("Why no action from the catalog fits the request."),
  });
  const variants = actions.map((action) =>
    z.object({
      kind: z.enum(["action"]),
      action: z.enum([action.name]),
      params: action.params,
      summary: z.string().describe("One sentence a reviewer can approve at a glance."),
    }),
  );

  const result = z.union([none, ...variants]);
  return z.object({ result }) as unknown as z.ZodType<ExtractionEnvelope>;
}
