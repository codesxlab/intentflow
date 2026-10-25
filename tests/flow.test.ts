import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ProviderOutputError,
  ProviderRefusalError,
  buildResultSchema,
  createIntentFlow,
  defineAction,
  officeActions,
  type CompletionRequest,
  type Provider,
  type TokenUsage,
} from "../src/index.js";
import { z } from "zod";

/** A provider that replays scripted outputs, to test the flow without any model. */
function scripted(outputs: unknown[]): Provider & { calls: number } {
  const provider = {
    name: "scripted",
    model: "test",
    calls: 0,
    async complete<T>(): Promise<T> {
      const next = outputs[provider.calls++];
      if (next instanceof Error) throw next;
      return next as T;
    },
  };
  return provider;
}

const valid = {
  result: {
    kind: "action",
    action: "send_email",
    params: { to: ["sarah@acme.com"], subject: "Invoice", body: "Please see the invoice." },
    summary: "Email Sarah about the invoice.",
  },
};

describe("createIntentFlow", () => {
  it("returns the validated extraction", async () => {
    const flow = createIntentFlow({ provider: scripted([valid]), actions: officeActions });
    const result = await flow.extract("Email sarah@acme.com about the invoice");
    assert.equal(result.kind, "action");
    assert.equal(result.kind === "action" && result.action, "send_email");
  });

  it("asks again when the output does not match the schema", async () => {
    const provider = scripted([{ result: { kind: "action", action: "send_email", params: { to: [] } } }, valid]);
    const flow = createIntentFlow({ provider, actions: officeActions });
    const result = await flow.extract("Email sarah@acme.com about the invoice");
    assert.equal(result.kind, "action");
    assert.equal(provider.calls, 2);
  });

  it("gives up after maxAttempts invalid outputs", async () => {
    const provider = scripted([{ nope: true }, { nope: true }, valid]);
    const flow = createIntentFlow({ provider, actions: officeActions, maxAttempts: 2 });
    await assert.rejects(flow.extract("Email Sarah"), ProviderOutputError);
    assert.equal(provider.calls, 2);
  });

  it("does not retry a refusal", async () => {
    const provider = scripted([new ProviderRefusalError("declined", "scripted"), valid]);
    const flow = createIntentFlow({ provider, actions: officeActions });
    await assert.rejects(flow.extract("Email Sarah"), ProviderRefusalError);
    assert.equal(provider.calls, 1);
  });

  it("rejects an action name that is not in the catalog", async () => {
    const provider = scripted([{ result: { ...valid.result, action: "wire_money" } }, { result: { kind: "none", reason: "n/a" } }]);
    const flow = createIntentFlow({ provider, actions: officeActions });
    const result = await flow.extract("Wire $5,000 to this account");
    assert.deepEqual(result, { kind: "none", reason: "n/a" });
  });

  it("reports token usage for every provider call, retries included", async () => {
    const outputs = [{ nope: true }, valid];
    let calls = 0;
    const provider: Provider = {
      name: "metered",
      model: "test",
      async complete<T>({ onUsage }: CompletionRequest<T>): Promise<T> {
        onUsage?.({ inputTokens: 100, outputTokens: 20 });
        return outputs[calls++] as T;
      },
    };
    const usage: TokenUsage[] = [];
    const flow = createIntentFlow({ provider, actions: officeActions });
    await flow.extract("Email sarah@acme.com about the invoice", { onUsage: (u) => usage.push(u) });
    assert.deepEqual(usage, [
      { inputTokens: 100, outputTokens: 20 },
      { inputTokens: 100, outputTokens: 20 },
    ]);
  });

  it("rejects empty and oversized input before calling the provider", async () => {
    const provider = scripted([valid]);
    const flow = createIntentFlow({ provider, actions: officeActions });
    await assert.rejects(flow.extract("   "), /empty/);
    await assert.rejects(flow.extract("x".repeat(9000)), /longer than/);
    assert.equal(provider.calls, 0);
  });
});

describe("catalog", () => {
  it("rejects invalid or duplicate action names", () => {
    assert.throws(() => defineAction({ name: "Send Email", description: "x", params: z.object({}) }), /lower_snake_case/);
    const a = defineAction({ name: "ping", description: "Ping someone.", params: z.object({ who: z.string() }) });
    assert.throws(() => buildResultSchema([a, a]), /Duplicate/);
    assert.throws(() => buildResultSchema([]), /empty/);
  });
});
