import type { ActionCatalog } from "./actions.js";

export function buildSystemPrompt(actions: ActionCatalog): string {
  const catalog = actions.map((action) => `- ${action.name}: ${action.description}`).join("\n");
  return [
    "You turn one incoming request into a proposed action for a person to review.",
    "Nothing you propose runs until a reviewer approves it, so your job is to make the proposal accurate and easy to check.",
    "",
    "Available actions:",
    catalog,
    "",
    "Choose an action only when the request clearly asks for something in the catalog. Otherwise return kind \"none\" with a short reason.",
    "Use the requester's own wording for names, times, and details. Do not invent recipients, dates, or content the request does not give; use null where a field allows it and the request leaves it open.",
    "If the request asks for several things, propose the main one and mention the rest in the summary.",
    "Write the summary as one plain sentence describing what will happen if the reviewer approves.",
  ].join("\n");
}
