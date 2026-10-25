import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { checkDetails, createIntentFlow, defineAction, officeActions, type Extraction, type Provider } from "../src/index.js";

const reschedule = (new_time: string): Extraction => ({
  kind: "action",
  action: "reschedule_meeting",
  params: { meeting: "design review", new_time, notify_attendees: false },
  summary: "Move the design review.",
});

const email = (to: string[], body: string | null = "Hi"): Extraction => ({
  kind: "action",
  action: "send_email",
  params: { to, subject: "Update", body },
  summary: "Send an email.",
});

describe("checkDetails", () => {
  it("turns empty or placeholder values of required fields into none", () => {
    for (const value of ["", "   ", "TBD", " later. ", "null", "später", "Belirtilmedi", "n/a"]) {
      const result = checkDetails(reschedule(value), "Can we push the design review?", officeActions);
      assert.equal(result.kind, "none", `"${value}" should count as missing`);
      assert.match(result.kind === "none" ? result.reason : "", /new_time/);
    }
  });

  it("keeps real values, including ones that contain a placeholder word", () => {
    for (const value of ["later today", "next Tuesday", "11:00", "cuma", "nächsten Dienstag"]) {
      assert.equal(checkDetails(reschedule(value), "Move the design review", officeActions).kind, "action", value);
    }
  });

  it("does not check nullable fields", () => {
    const task: Extraction = { kind: "action", action: "create_task", params: { title: "Call the bank", due: null, assignee: null }, summary: "x" };
    assert.equal(checkDetails(task, "Remind me to call the bank", officeActions).kind, "action");
    assert.equal(checkDetails(email(["sarah@acme.com"], null), "Forward the deck to sarah@acme.com", officeActions).kind, "action");
  });

  it("rejects grounded values that do not appear in the request", () => {
    const madeUp = checkDetails(email(["operations@company.com"]), "Send an email about the outage.", officeActions);
    assert.equal(madeUp.kind, "none");
    assert.match(madeUp.kind === "none" ? madeUp.reason : "", /operations@company\.com/);

    const oneMadeUp = checkDetails(email(["sarah@acme.com", "boss@acme.com"]), "Email sarah@acme.com about the invoice", officeActions);
    assert.equal(oneMadeUp.kind, "none");

    assert.equal(checkDetails(email([""]), "Kesintiyle ilgili bir e-posta gönder.", officeActions).kind, "none");
  });

  it("accepts grounded values across case, suffixes, and diacritics", () => {
    assert.equal(checkDetails(email(["Mert"]), "Mert'e yarınki deploy hakkında not gönder.", officeActions).kind, "action");
    assert.equal(checkDetails(email(["Ayse"]), "Ayşe'ye bir mail at.", officeActions).kind, "action");
    assert.equal(checkDetails(email(["ELIF"]), "Kannst du Elif eben mailen?", officeActions).kind, "action");
    assert.equal(checkDetails(email(["ops@codesxlab.com"]), "Mail it to OPS@codesxlab.com", officeActions).kind, "action");
  });

  it("passes none through and can be turned off in the flow", async () => {
    const none: Extraction = { kind: "none", reason: "n/a" };
    assert.deepEqual(checkDetails(none, "anything", officeActions), none);

    const provider: Provider = { name: "fixed", model: "test", complete: async <T>() => ({ result: reschedule("later") }) as T };
    const strict = createIntentFlow({ provider, actions: officeActions });
    const lenient = createIntentFlow({ provider, actions: officeActions, checkDetails: false });
    assert.equal((await strict.extract("Can we push the design review?")).kind, "none");
    assert.equal((await lenient.extract("Can we push the design review?")).kind, "action");
  });
});

describe("defineAction grounded", () => {
  it("rejects a grounded field that is not a param", () => {
    assert.throws(
      () => defineAction({ name: "ping", description: "Ping someone.", params: z.object({ who: z.string() }), grounded: ["whom" as "who"] }),
      /grounded field "whom"/,
    );
  });
});
