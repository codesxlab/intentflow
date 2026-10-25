import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApprovalQueue, ProposalStateError, officeActions, type ActionExtraction } from "../src/index.js";

const extraction: ActionExtraction = {
  kind: "action",
  action: "create_task",
  params: { title: "Renew the domain", due: "Friday", assignee: null },
  summary: 'Create the task "Renew the domain" due Friday.',
};
const meta = { input: "Remind me to renew the domain by Friday", provider: "mock", model: "rules-v1" };

function setup() {
  const calls: Record<string, unknown>[] = [];
  let n = 0;
  const queue = new ApprovalQueue({
    actions: officeActions,
    executors: { create_task: (params) => { calls.push(params); return { ok: true }; } },
    now: () => new Date("2026-01-01T00:00:00Z"),
    newId: () => `p${++n}`,
  });
  return { queue, calls };
}

describe("ApprovalQueue", () => {
  it("keeps new proposals pending and runs nothing", () => {
    const { queue, calls } = setup();
    const proposal = queue.propose(extraction, meta);
    assert.equal(proposal.status, "pending");
    assert.equal(calls.length, 0);
    assert.deepEqual(queue.list("pending").map((p) => p.id), ["p1"]);
  });

  it("runs the executor only after approval and records who approved", async () => {
    const { queue, calls } = setup();
    const { id } = queue.propose(extraction, meta);
    const done = await queue.approve(id, "ertunc");
    assert.equal(done.status, "executed");
    assert.deepEqual(done.result, { ok: true });
    assert.equal(calls.length, 1);
    assert.deepEqual(done.history.map((h) => h.event), ["proposed", "approved", "executed"]);
    assert.equal(done.history[1]?.by, "ertunc");
  });

  it("never runs a rejected proposal", async () => {
    const { queue, calls } = setup();
    const { id } = queue.propose(extraction, meta);
    const rejected = queue.reject(id, "ertunc", "Wrong date");
    assert.equal(rejected.status, "rejected");
    await assert.rejects(queue.approve(id, "ertunc"), ProposalStateError);
    assert.equal(calls.length, 0);
  });

  it("does not run an approved proposal twice", async () => {
    const { queue, calls } = setup();
    const { id } = queue.propose(extraction, meta);
    await queue.approve(id, "ertunc");
    await assert.rejects(queue.approve(id, "ertunc"), ProposalStateError);
    assert.equal(calls.length, 1);
  });

  it("requires a reviewer name for every decision", async () => {
    const { queue } = setup();
    const { id } = queue.propose(extraction, meta);
    await assert.rejects(queue.approve(id, "  "), /reviewer/);
    assert.throws(() => queue.reject(id, ""), /reviewer/);
  });

  it("validates edits against the action schema", () => {
    const { queue } = setup();
    const { id } = queue.propose(extraction, meta);
    assert.throws(() => queue.edit(id, { title: 42 }, "ertunc"), /Invalid parameters/);
    const edited = queue.edit(id, { title: "Renew codesxlab.com", due: "Thursday", assignee: null }, "ertunc");
    assert.equal(edited.params.title, "Renew codesxlab.com");
    assert.equal(edited.status, "pending");
  });

  it("rejects proposals for unknown actions or with invalid params", () => {
    const { queue } = setup();
    assert.throws(() => queue.propose({ ...extraction, action: "delete_everything" }, meta), /Unknown action/);
    assert.throws(() => queue.propose({ ...extraction, params: { title: "x" } }, meta), /Invalid parameters/);
  });

  it("marks the proposal failed when the executor throws", async () => {
    const queue = new ApprovalQueue({
      actions: officeActions,
      executors: { create_task: () => { throw new Error("Calendar API is down"); } },
    });
    const { id } = queue.propose(extraction, meta);
    const result = await queue.approve(id, "ertunc");
    assert.equal(result.status, "failed");
    assert.equal(result.error, "Calendar API is down");
  });

  it("returns copies, so callers cannot change stored proposals", () => {
    const { queue } = setup();
    const proposal = queue.propose(extraction, meta);
    proposal.status = "executed";
    proposal.params.title = "changed";
    assert.equal(queue.get(proposal.id)?.status, "pending");
    assert.equal(queue.get(proposal.id)?.params.title, "Renew the domain");
  });
});
