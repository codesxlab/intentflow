import { findAction, type ActionCatalog } from "./actions.js";
import type { Extraction } from "./schema.js";

/**
 * Values that mean "not given" rather than a real detail. A required field that holds one of these
 * (compared whole, ignoring case and surrounding punctuation) counts as missing.
 */
export const PLACEHOLDER_VALUES: ReadonlySet<string> = new Set([
  "", "null", "none", "nil", "undefined", "n/a", "na", "-", "?", "...", "…",
  "tbd", "tba", "tbc", "unknown", "unspecified", "not specified", "not given", "later", "someone", "recipient",
  // Turkish
  "belirtilmedi", "belirtilmemiş", "bilinmiyor", "yok", "sonra", "daha sonra",
  // German
  "unbekannt", "offen", "später", "nicht angegeben", "keine angabe",
]);

/** Lowercase, without diacritics, for loose comparisons across languages ("Ayşe" ~ "ayse"). */
function fold(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_VALUES.has(value.trim().replace(/^["'`(\[]+|["'`)\].!:;,]+$/g, "").trim().toLocaleLowerCase());
}

/** Field values as a list of strings (arrays are flattened), or undefined for non-string fields. */
function strings(value: unknown): string[] | undefined {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value as string[];
  return undefined;
}

/**
 * Checks that a proposed action has every detail it needs, taken from the request:
 *   - a required (non-nullable) text field is not empty and not a placeholder such as "later" or "TBD";
 *   - a field listed in the action's `grounded` appears in the request, so it was not made up.
 *
 * Returns the extraction unchanged when it passes, otherwise a "none" with the reason, so a person
 * sees what is missing instead of an action filled with a guess.
 */
export function checkDetails(extraction: Extraction, input: string, actions: ActionCatalog): Extraction {
  if (extraction.kind !== "action") return extraction;
  const action = findAction(actions, extraction.action);
  if (!action) return extraction;

  const request = fold(input);
  const shape = action.params.shape as Record<string, { safeParse(value: unknown): { success: boolean } }>;

  for (const [field, schema] of Object.entries(shape)) {
    const values = strings(extraction.params[field]);
    if (!values || schema.safeParse(null).success) continue; // non-text or nullable: nothing to check

    const given = values.filter((value) => !isPlaceholder(value));
    if (given.length === 0) {
      return { kind: "none", reason: `The request asks for ${action.name} but does not give "${field}".` };
    }
    if (action.grounded?.includes(field)) {
      const madeUp = given.find((value) => !request.includes(fold(value.trim())));
      if (madeUp !== undefined) {
        return {
          kind: "none",
          reason: `The request asks for ${action.name} but does not give "${field}"; "${madeUp}" does not appear in it.`,
        };
      }
    }
  }
  return extraction;
}
