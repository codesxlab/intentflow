import { randomUUID } from "node:crypto";
import { findAction, type ActionCatalog } from "./actions.js";
import type { ActionExtraction } from "./schema.js";

export type ProposalStatus = "pending" | "approved" | "rejected" | "executed" | "failed";

export interface AuditEntry {
  at: string;
  event: "proposed" | "edited" | "approved" | "rejected" | "executed" | "failed";
  by?: string;
  note?: string;
}

export interface Proposal {
  id: string;
  input: string;
  action: string;
  params: Record<string, unknown>;
  summary: string;
  status: ProposalStatus;
  provider: string;
  model: string;
  createdAt: string;
  history: AuditEntry[];
  result?: unknown;
  error?: string;
}

/** Runs an approved action. Executors are only ever called from `approve()`. */
export type Executor = (params: Record<string, unknown>, proposal: Proposal) => unknown | Promise<unknown>;

export interface ApprovalQueueOptions {
  actions: ActionCatalog;
  executors?: Record<string, Executor>;
  now?: () => Date;
  newId?: () => string;
}

export class ProposalStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalStateError";
  }
}

/**
 * Holds proposals until a person decides. Nothing runs while a proposal is pending,
 * and every decision is recorded with who made it.
 *
 * In-memory by design: swap in your own storage by mirroring this interface.
 */
export class ApprovalQueue {
  readonly #actions: ActionCatalog;
  readonly #executors: Record<string, Executor>;
  readonly #now: () => Date;
  readonly #newId: () => string;
  readonly #proposals = new Map<string, Proposal>();

  constructor(options: ApprovalQueueOptions) {
    this.#actions = options.actions;
    this.#executors = options.executors ?? {};
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? randomUUID;
  }

  propose(extraction: ActionExtraction, meta: { input: string; provider: string; model: string }): Proposal {
    const params = this.#validate(extraction.action, extraction.params);
    const at = this.#now().toISOString();
    const proposal: Proposal = {
      id: this.#newId(),
      input: meta.input,
      action: extraction.action,
      params,
      summary: extraction.summary,
      status: "pending",
      provider: meta.provider,
      model: meta.model,
      createdAt: at,
      history: [{ at, event: "proposed", by: `${meta.provider}:${meta.model}` }],
    };
    this.#proposals.set(proposal.id, proposal);
    return structuredClone(proposal);
  }

  get(id: string): Proposal | undefined {
    const proposal = this.#proposals.get(id);
    return proposal && structuredClone(proposal);
  }

  list(status?: ProposalStatus): Proposal[] {
    return [...this.#proposals.values()]
      .filter((proposal) => !status || proposal.status === status)
      .map((proposal) => structuredClone(proposal));
  }

  /** Lets the reviewer correct the parameters before approving. The edit is validated like the original. */
  edit(id: string, params: Record<string, unknown>, by: string): Proposal {
    const proposal = this.#pending(id);
    proposal.params = this.#validate(proposal.action, params);
    proposal.history.push({ at: this.#now().toISOString(), event: "edited", by: this.#reviewer(by) });
    return structuredClone(proposal);
  }

  reject(id: string, by: string, reason?: string): Proposal {
    const proposal = this.#pending(id);
    proposal.status = "rejected";
    proposal.history.push({ at: this.#now().toISOString(), event: "rejected", by: this.#reviewer(by), note: reason });
    return structuredClone(proposal);
  }

  /** Approves a pending proposal and, if an executor is registered for its action, runs it. */
  async approve(id: string, by: string): Promise<Proposal> {
    const proposal = this.#pending(id);
    const reviewer = this.#reviewer(by);
    proposal.status = "approved";
    proposal.history.push({ at: this.#now().toISOString(), event: "approved", by: reviewer });

    const executor = this.#executors[proposal.action];
    if (executor) {
      try {
        proposal.result = await executor(structuredClone(proposal.params), structuredClone(proposal));
        proposal.status = "executed";
        proposal.history.push({ at: this.#now().toISOString(), event: "executed" });
      } catch (error) {
        proposal.status = "failed";
        proposal.error = error instanceof Error ? error.message : String(error);
        proposal.history.push({ at: this.#now().toISOString(), event: "failed", note: proposal.error });
      }
    }
    return structuredClone(proposal);
  }

  #pending(id: string): Proposal {
    const proposal = this.#proposals.get(id);
    if (!proposal) throw new ProposalStateError(`No proposal with id "${id}".`);
    if (proposal.status !== "pending") {
      throw new ProposalStateError(`Proposal "${id}" is already ${proposal.status}.`);
    }
    return proposal;
  }

  #reviewer(by: string): string {
    const reviewer = by.trim();
    if (!reviewer) throw new ProposalStateError("A reviewer name is required for every decision.");
    return reviewer;
  }

  #validate(actionName: string, params: unknown): Record<string, unknown> {
    const action = findAction(this.#actions, actionName);
    if (!action) throw new ProposalStateError(`Unknown action "${actionName}".`);
    const checked = action.params.safeParse(params);
    if (!checked.success) {
      throw new ProposalStateError(`Invalid parameters for "${actionName}": ${checked.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`);
    }
    return checked.data as Record<string, unknown>;
  }
}
