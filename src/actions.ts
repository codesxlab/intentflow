import { z } from "zod";

/**
 * An action the model may propose. `params` is a zod object; it becomes part of the
 * JSON schema the model must follow, and every proposal is validated against it.
 *
 * Tip: prefer `.nullable()` over `.optional()` for fields the request may leave open.
 * Strict structured-output modes (OpenAI in particular) require every field to be present.
 */
export interface ActionDefinition<P extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  params: P;
  /**
   * Text fields whose values must appear in the request itself, such as recipients. A proposal
   * whose value for one of these is not found in the request becomes "none" instead of
   * reaching the queue with a made-up value. See `checkDetails`.
   */
  grounded?: readonly (keyof z.infer<P> & string)[];
}

const ACTION_NAME = /^[a-z][a-z0-9_]{0,63}$/;

export function defineAction<P extends z.ZodObject>(definition: ActionDefinition<P>): ActionDefinition<P> {
  if (!ACTION_NAME.test(definition.name)) {
    throw new Error(`Invalid action name "${definition.name}": use lower_snake_case (a-z, 0-9, _).`);
  }
  if (!definition.description.trim()) {
    throw new Error(`Action "${definition.name}" needs a description; the model uses it to choose actions.`);
  }
  for (const field of definition.grounded ?? []) {
    if (!(field in definition.params.shape)) {
      throw new Error(`Action "${definition.name}": grounded field "${field}" is not one of its params.`);
    }
  }
  return definition;
}

/** A small example catalog used by the demo, the evals, and the tests. */
export const officeActions = [
  defineAction({
    name: "reschedule_meeting",
    description: "Move an existing meeting or call to a different time.",
    params: z.object({
      meeting: z.string().describe("The meeting as the requester referred to it, e.g. 'onboarding call'."),
      new_time: z.string().describe("The new time exactly as stated, e.g. 'next Tuesday at 10:00'."),
      notify_attendees: z.boolean().describe("True if the request asks to tell or update the other attendees."),
    }),
  }),
  defineAction({
    name: "send_email",
    description: "Send a new email message to one or more recipients.",
    params: z.object({
      to: z.array(z.string()).min(1).describe("Recipients as given: email addresses or names."),
      subject: z.string().describe("A short subject line based on the request."),
      body: z
        .string()
        .nullable()
        .describe("The message to send, using only details the request provides, or null if it gives no message (e.g. only a document to forward)."),
    }),
    // Never email an address or person the request did not name.
    grounded: ["to"],
  }),
  defineAction({
    name: "create_task",
    description: "Create a to-do item or reminder.",
    params: z.object({
      title: z.string().describe("What needs to be done."),
      due: z.string().nullable().describe("The due date or time as stated, or null if none is given."),
      assignee: z.string().nullable().describe("Who should do it, or null if not stated."),
    }),
  }),
] as const;

export type ActionCatalog = readonly ActionDefinition[];

export function findAction(actions: ActionCatalog, name: string): ActionDefinition | undefined {
  return actions.find((action) => action.name === name);
}
