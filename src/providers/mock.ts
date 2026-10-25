import { ProviderOutputError, type CompletionRequest, type Provider } from "./types.js";

/**
 * A deterministic, rule-based provider for the example office catalog.
 *
 * It needs no API key, so the demo, tests, and CI run anywhere. It is a keyword baseline,
 * not a model: use it to exercise the pipeline and as the floor that real providers should beat
 * in the evals.
 */
export function mockProvider(): Provider {
  return {
    name: "mock",
    model: "rules-v1",
    async complete<T>({ input, schema, actions }: CompletionRequest<T>): Promise<T> {
      const available = new Set(actions.map((action) => action.name));
      const candidate = { result: guess(input, available) };
      const parsed = schema.safeParse(candidate);
      if (!parsed.success) {
        throw new ProviderOutputError("Mock output did not match the schema.", "mock", { cause: parsed.error });
      }
      return parsed.data;
    },
  };
}

const DAYS = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
const CLOCK = String.raw`(?:\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?`;
const WHEN = new RegExp(
  String.raw`\b(` +
    [
      String.raw`(?:next|this)\s+(?:${DAYS}|week|month)`,
      String.raw`tomorrow(?:\s+(?:morning|afternoon|evening))?`,
      String.raw`today|tonight`,
      String.raw`(?:on\s+)?(?:${DAYS})`,
      String.raw`end of (?:the )?(?:day|week|month)`,
      String.raw`(?:${MONTHS})[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?`,
      String.raw`\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:${MONTHS})[a-z]*`,
    ].join("|") +
    String.raw`)${CLOCK}`,
  "i",
);

const MEETING_NOUN = String.raw`(?:meeting|call|sync|standup|stand-up|demo|review|interview|1:1|one-on-one|catch-up|check-in)`;
const RESCHEDULE_VERB = /\b(?:reschedul\w*|move|push|postpone|shift|bump)\b/i;
const MEETING = new RegExp(String.raw`\b${MEETING_NOUN}\b`, "i");
const MEETING_PHRASE = new RegExp(
  String.raw`\b(?:the|our|my|today's|tomorrow's|this)\s+((?:[\w'-]+\s+){0,3}?${MEETING_NOUN})`,
  "i",
);
const NOTIFY = /\b(?:let\s+(?:\w+\s+){0,3}know|notify|tell|inform|update\s+(?:the\s+)?(?:team|attendees|everyone|others)|send\s+(?:out\s+)?(?:the\s+)?(?:\w+\s+)?(?:invite|agenda|update))\b/i;

const TASK_TRIGGER = /\b(?:remind\s+me(?:\s+to)?|add\s+(?:a\s+)?(?:task|to-?do)(?:\s+to)?|create\s+(?:a\s+)?(?:task|to-?do)(?:\s+to)?|don'?t\s+(?:let\s+me\s+)?forget(?:\s+to)?|make\s+a\s+note\s+to)\b/i;
const ASSIGNEE = /\b(?:for|assign(?:ed)?\s+(?:it\s+)?to)\s+([A-Z][a-z]+)\b/;

const EMAIL_TRIGGER = /\b(?:e-?mail|send\s+(?:a|an)\s+(?:note|message|mail)|write\s+to|drop\s+(?:a\s+)?(?:note|line))\b/i;
const EMAIL_ADDRESS = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const RECIPIENT_NAME = /\b(?:to|e-?mail|write\s+to|line\s+to|note\s+to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/;

type Guess =
  | { kind: "action"; action: string; params: Record<string, unknown>; summary: string }
  | { kind: "none"; reason: string };

function guess(input: string, available: Set<string>): Guess {
  const text = input.trim();

  if (available.has("reschedule_meeting") && RESCHEDULE_VERB.test(text) && MEETING.test(text)) {
    const meeting = MEETING_PHRASE.exec(text)?.[1] ?? MEETING.exec(text)?.[0] ?? "meeting";
    const afterMeeting = text.slice(text.toLowerCase().indexOf(meeting.toLowerCase()) + meeting.length);
    const newTime = WHEN.exec(afterMeeting)?.[0] ?? WHEN.exec(text)?.[0];
    if (!newTime) {
      return { kind: "none", reason: "The request asks to move a meeting but does not say when to." };
    }
    const notify = NOTIFY.test(text);
    return {
      kind: "action",
      action: "reschedule_meeting",
      params: { meeting, new_time: clean(newTime), notify_attendees: notify },
      summary: `Move the ${meeting} to ${clean(newTime)}${notify ? " and notify attendees" : ""}.`,
    };
  }

  if (available.has("create_task") && TASK_TRIGGER.test(text)) {
    const rest = text.slice((TASK_TRIGGER.exec(text)?.index ?? 0) + (TASK_TRIGGER.exec(text)?.[0].length ?? 0));
    const due = WHEN.exec(rest)?.[0] ?? null;
    const assignee = ASSIGNEE.exec(rest)?.[1] ?? null;
    let title = rest;
    if (due) title = title.replace(due, "");
    if (assignee) title = title.replace(ASSIGNEE, "");
    title = capitalize(clean(title.replace(/\b(?:by|on|before|until)\s*$/i, "")));
    if (!title) return { kind: "none", reason: "The request asks for a task but does not say what it is." };
    return {
      kind: "action",
      action: "create_task",
      params: { title, due: due ? clean(due) : null, assignee },
      summary: `Create the task "${title}"${due ? ` due ${clean(due)}` : ""}${assignee ? ` for ${assignee}` : ""}.`,
    };
  }

  if (available.has("send_email") && EMAIL_TRIGGER.test(text)) {
    const addresses = text.match(EMAIL_ADDRESS) ?? [];
    const name = RECIPIENT_NAME.exec(text)?.[1];
    const to = addresses.length > 0 ? addresses : name ? [name] : [];
    if (to.length === 0) {
      return { kind: "none", reason: "The request asks for an email but does not say who it is for." };
    }
    const topic = /\babout\s+([^.!?\n]+)/i.exec(text)?.[1];
    const subject = topic ? capitalize(clean(topic)) : "Quick note";
    return {
      kind: "action",
      action: "send_email",
      params: { to, subject, body: text },
      summary: `Email ${to.join(", ")} with the subject "${subject}".`,
    };
  }

  return { kind: "none", reason: "No action in the catalog matches this request." };
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").replace(/^[\s,.;:-]+|[\s,.;:!?-]+$/g, "").trim();
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
