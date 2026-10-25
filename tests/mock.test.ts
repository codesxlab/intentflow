import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createIntentFlow, mockProvider, officeActions } from "../src/index.js";

const flow = createIntentFlow({ provider: mockProvider(), actions: officeActions });

describe("mockProvider", () => {
  it("recognises a reschedule request with notification", async () => {
    const result = await flow.extract("Could you move our onboarding call to next Tuesday and send the updated agenda to the team?");
    assert.deepEqual(result.kind === "action" && result.params, {
      meeting: "onboarding call",
      new_time: "next Tuesday",
      notify_attendees: true,
    });
  });

  it("returns none when a required detail is missing instead of guessing", async () => {
    const result = await flow.extract("Can we push the design review?");
    assert.equal(result.kind, "none");
  });

  it("only proposes actions that are in the catalog it was given", async () => {
    const tasksOnly = createIntentFlow({ provider: mockProvider(), actions: officeActions.filter((a) => a.name === "create_task") });
    const result = await tasksOnly.extract("Email sarah@acme.com about the invoice");
    assert.equal(result.kind, "none");
  });
});
