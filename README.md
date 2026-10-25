# intentflow

**Turn messages into reviewed, structured actions with any LLM.**

[![CI](https://github.com/codesxlab/intentflow/actions/workflows/ci.yml/badge.svg)](https://github.com/codesxlab/intentflow/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@codesxlab/intentflow.svg)](https://www.npmjs.com/package/@codesxlab/intentflow)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

intentflow takes a free-text request ("Move our onboarding call to next Tuesday and send the agenda to the team"), asks a language model to turn it into **one action from a catalog you define**, validates the result against a schema, and puts it in an **approval queue**. Nothing runs until a person approves it.

![intentflow demo: a request becomes a proposed action, a reviewer approves it](docs/demo.gif)

- **Model-agnostic.** Adapters for the Claude API and the OpenAI API ship in the box. A provider is one small interface, so local models or rule sets plug in the same way.
- **Structured, validated output.** Each action's parameters are a [zod](https://zod.dev) schema. The model gets that schema as a structured-output format, and every result is validated again before it reaches the queue. Invalid output is retried once, then reported.
- **Human-in-the-loop by design.** Proposals start as `pending`. Executors run only from `approve()`, every decision needs a reviewer name, and each proposal keeps an audit trail.
- **Measured.** 71 realistic requests in English, Turkish, and German (negations, implicit requests, missing details, out-of-catalog asks) report action and parameter accuracy per provider and language, with the tokens each call used. [Results below.](#evals)

**[Try the live demo →](https://codesxlab.github.io/intentflow/)** It runs in your browser with the rule-based mock provider; nothing you type leaves the page.

> **Status:** early prototype by [CodesXlab](https://www.codesxlab.com). The API may change and the queue is in-memory.

## How it works

```
 request ──▶ model (Claude, OpenAI, …) ──▶ schema check ──▶ approval queue ──▶ reviewer ──▶ executor
             proposes ONE catalog action    zod, retry once   status: pending    approve /     runs only
             or "none" with a reason                                             reject / edit after approval
```

## Quickstart

Requires Node.js 22 or later.

```bash
git clone https://github.com/codesxlab/intentflow.git
cd intentflow
npm install
npm run demo          # http://localhost:3000, mock provider, no API key needed
```

With a real model:

```bash
ANTHROPIC_API_KEY=... INTENTFLOW_PROVIDER=anthropic npm run demo
OPENAI_API_KEY=...    INTENTFLOW_PROVIDER=openai    npm run demo
```

The demo's executors are simulated: approving shows what *would* happen. Nothing is sent or booked.

## Use it as a library

```bash
npm install @codesxlab/intentflow zod
```

`zod` is a peer dependency, so your action schemas and intentflow share one copy.

```ts
import { z } from "zod";
import { ApprovalQueue, anthropicProvider, createIntentFlow, defineAction } from "@codesxlab/intentflow";

const actions = [
  defineAction({
    name: "create_task",
    description: "Create a to-do item or reminder.",
    params: z.object({
      title: z.string(),
      due: z.string().nullable(),       // prefer .nullable() over .optional(); strict modes need every field
      assignee: z.string().nullable(),
    }),
  }),
];

const flow = createIntentFlow({ provider: anthropicProvider(), actions });
const queue = new ApprovalQueue({
  actions,
  executors: { create_task: async (params) => myTaskApi.create(params) },
});

const input = "Add a task for Elif to update the pricing page next week";
const extraction = await flow.extract(input);

if (extraction.kind === "action") {
  const proposal = queue.propose(extraction, { input, provider: flow.provider.name, model: flow.provider.model });
  // ...show it to a person...
  await queue.approve(proposal.id, "ertunc"); // the executor runs here, and only here
} else {
  console.log("No action:", extraction.reason);
}
```

Reviewers can also `queue.reject(id, by, reason)` or correct the parameters first with `queue.edit(id, params, by)`. Edits are validated against the same schema.

### Missing or made-up details

Models tend to fill a gap rather than admit it: asked to "push the design review" with no new time, they propose the move anyway with `"later"` or an empty string (see [Evals](#evals)). So after the schema check, `createIntentFlow` runs `checkDetails` and turns such a proposal into `none`, with a reason a reviewer can act on:

- A **required** text field (not `.nullable()`) must not be empty or a placeholder such as `"later"`, `"TBD"`, `"null"`, `"später"`, or `"belirtilmedi"`. Mark fields the request may leave open as `.nullable()`; they are not checked.
- A field listed in the action's **`grounded`** must appear in the request itself (ignoring case and accents), so the model cannot invent it:

```ts
defineAction({
  name: "send_email",
  description: "Send a new email message to one or more recipients.",
  params: z.object({ to: z.array(z.string()).min(1), subject: z.string(), body: z.string().nullable() }),
  grounded: ["to"], // never email an address the request did not name
});
```

Pass `checkDetails: false` to `createIntentFlow` to get the provider's proposal as is.

## Providers

| Provider | Default model | How it gets structured output |
|---|---|---|
| `anthropicProvider()` | `claude-opus-5-5` | `client.beta.messages.parse` with `output_config.format`; effort `medium`; server-side refusal fallback (`fallbacks: "default"`) on by default |
| `openaiProvider()` | `gpt-6-astra` (override with `INTENTFLOW_OPENAI_MODEL`, e.g. `gpt-6.1-sol` or `gpt-6-luna`) | Responses API `responses.parse` with a strict JSON-schema text format |
| `mockProvider()` | `rules-v1` | Deterministic keyword rules for the example catalog. No key, used by the demo, tests, and CI |

Every provider's output is validated again with zod in `createIntentFlow`. A custom provider implements one method:

```ts
interface Provider {
  name: string;
  model: string;
  complete<T>(request: { system: string; input: string; schema: z.ZodType<T>; schemaName: string; actions: { name: string; description: string }[] }): Promise<T>;
}
```

Throw `ProviderOutputError` for retryable output problems and `ProviderRefusalError` when the model declines; refusals are not retried.

## Evals

```bash
npm run eval                                            # mock provider, all languages
node --env-file=.env --import tsx evals/run.ts --provider openai --json out.json
npm run eval -- --provider openai --sample 1            # first case per language: measure tokens cheaply
npm run eval -- --lang tr,de                            # only some languages
npm run eval -- --provider openai --price-in 10 --price-out 50   # USD per 1M tokens → cost estimate
npm run eval -- --ids de-email-no-recipient             # re-run specific cases
npm run eval -- --replay evals/published/openai-gpt-6-astra.json   # recorded outputs, no API calls
```

[`evals/cases.json`](evals/cases.json) holds 71 requests (23 English, 24 Turkish, 24 German) with the expected action and the parameters a reviewer would check. Every language covers the same situations: plain and implicit requests, negations ("no need to tell anyone"), several requests in one sentence, missing details, and out-of-catalog asks (payments, deleting data).

Measured on 2026-10-25, full match (action + parameters) with action accuracy in brackets:

| Provider · model | English | Turkish | German | All | Tokens per case |
|---|---|---|---|---|---|
| `openai` · `gpt-6-astra` | 91.3% (91.3%) | 91.7% (91.7%) | 91.7% (91.7%) | **91.5%** (91.5%) | 663 in · 144 out |
| `mock` · `rules-v1` (keyword rules) | 73.9% (87.0%) | 25.0% (25.0%) | 25.0% (25.0%) | 40.8% (45.1%) | – |

Raw results, including every model output: [`evals/published/`](evals/published/). The full gpt-6-astra run (71 calls, 47,041 input and 10,221 output tokens) cost about $0.98 at the listed standard rates of $10 / $50 per 1M tokens.

**What the numbers show.** The model gets every action right in all three languages, with one exception that repeats in each language: requests that **leave out a required detail**. Asked "Can we push the design review?" (no new time) or "Send an email about the outage" (no recipient), it proposes the action anyway instead of returning `none`, filling the gap with `"later"`, an empty string, or, in one English case, an invented address (`operations@company.com`) and an invented message. These six cases are why intentflow keeps a person in the loop.

**The fix, measured offline.** Since then, intentflow checks details after the schema (see [Missing or made-up details](#missing-or-made-up-details)), and the prompt asks the model to return `none` when a required detail is missing. Replaying the 71 recorded gpt-6-astra outputs through the new pipeline (`--replay`, no API calls) turns all six failures into `none` without rejecting any of the 65 correct proposals: 100% on the recorded outputs ([report](evals/published/replays/)). This measures the checks, not the new prompt rule, and the checks were written after seeing these failures, so a live re-run is still needed; it is next on the list. The checks have their own tests on cases outside the suite (placeholder words inside real values, Turkish suffixes, accents, partly invented recipient lists).

The keyword baseline only knows English, so in Turkish and German it can only get the "no action" cases right. CI runs it on the English cases and fails if it drops below 70%.

## Project layout

```
src/
  actions.ts        defineAction() and the example office catalog
  schema.ts         builds the "one action or none" schema from a catalog
  prompt.ts         the system prompt
  flow.ts           createIntentFlow(): extract, validate, retry
  details.ts        checkDetails(): missing or made-up required details become "none"
  queue.ts          ApprovalQueue: pending → approved/rejected → executed/failed, with audit trail
  providers/        anthropic.ts, openai.ts, mock.ts
demo/               local web demo (node:http + one HTML page); build-site.ts makes the hosted version
evals/              cases.json, the runner, replay.ts, and published/ results
tests/              node:test suites
```

## Development

```bash
npm run typecheck
npm test
npm run eval
```

## Roadmap

- Re-run the live evals with the missing-detail prompt rule and checks (measured so far on recorded outputs only)
- Eval results for more providers and models (Claude, smaller OpenAI models) and more languages
- Persistent queue storage (SQLite / Postgres adapters)
- More action catalogs (CRM updates, support triage, document intake)
- Inbound connectors (email, Slack, webhooks) that feed the queue

## License

[MIT](LICENSE) © 2026 CodesXlab
