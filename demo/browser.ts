/**
 * The hosted demo (GitHub Pages): the same page as `npm run demo`, but the "API" runs in the
 * browser with the rule-based mock provider. No model is called and nothing leaves the page.
 *
 * Imports the modules directly (not src/index.ts) so the bundle does not pull in the SDKs.
 */
import { officeActions } from "../src/actions.js";
import { createIntentFlow } from "../src/flow.js";
import { mockProvider } from "../src/providers/mock.js";
import { ApprovalQueue } from "../src/queue.js";
import { simulatedExecutors } from "./simulated.js";

const provider = mockProvider();
const flow = createIntentFlow({ provider, actions: officeActions });
const queue = new ApprovalQueue({ actions: officeActions, executors: simulatedExecutors });

async function local(path: string, body?: Record<string, unknown>): Promise<unknown> {
  if (path === "/api/info") {
    return {
      provider: provider.name,
      model: provider.model,
      hosted: true,
      actions: officeActions.map(({ name, description }) => ({ name, description })),
    };
  }
  if (path === "/api/proposals") return queue.list().reverse();
  if (path === "/api/extract") {
    const input = String(body?.input ?? "");
    const extraction = await flow.extract(input);
    const proposal = extraction.kind === "action" ? queue.propose(extraction, { input, provider: provider.name, model: provider.model }) : undefined;
    return { extraction, proposal };
  }
  const match = /^\/api\/proposals\/([\w-]+)\/(approve|reject)$/.exec(path);
  if (match) {
    const [, id = "", decision] = match;
    const by = String(body?.by ?? "");
    return decision === "approve" ? queue.approve(id, by) : queue.reject(id, by);
  }
  throw new Error("Not found.");
}

(globalThis as { intentflowLocal?: typeof local }).intentflowLocal = local;
