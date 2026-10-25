import type { Executor } from "../src/queue.js";

/**
 * Demo executors: approving returns a description of what would happen.
 * Nothing is sent, booked, or written anywhere.
 */
const simulate = (describe: (params: Record<string, unknown>) => string): Executor => (params) => ({ simulated: true, message: describe(params) });

export const simulatedExecutors: Record<string, Executor> = {
  reschedule_meeting: simulate((p) => `Would move "${p.meeting}" to ${p.new_time}${p.notify_attendees ? " and notify attendees" : ""}.`),
  send_email: simulate((p) => `Would email ${(p.to as string[]).join(", ")}: "${p.subject}".`),
  create_task: simulate((p) => `Would create the task "${p.title}"${p.due ? ` due ${p.due}` : ""}${p.assignee ? ` for ${p.assignee}` : ""}.`),
};
