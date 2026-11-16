import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  appendIntakeAudit,
  canStartLeadFromQueueItem,
  createAuditEvent,
  createEmptyBacklog,
  enqueueCustomerRequest,
  getCostForItem,
  getRequestForItem,
  markQueueItemDone,
  markQueueItemInDev,
  parseBacklogQueue,
  recordCostApprovalOnQueue,
  recordQueueApproval,
  reorderBacklog,
  rebalanceBacklogFairness,
  updateCustomerRequest,
  upsertCustomer,
  viewBacklog,
  viewBacklogByCustomer,
  sumCostsByCustomer,
  type BacklogQueue,
  type CostApprovalStatus,
  type EnqueueCustomerRequestInput,
  type QueueApprovalDecision,
  type ReorderBacklogInput,
  type UpdateCustomerRequestInput,
  type UpsertCustomerInput,
} from "@releasedesk/core";
import {
  LeadOrchestrator,
  type LeadOrchestratorOptions,
  type ReleaseCheckReport,
  type StartReleaseCheckInput,
} from "./orchestrator.js";

/**
 * Customer intake module — enqueue / dual-approve / reorder / start Lead.
 * Unapproved (or partially approved) queue items must NOT enter Lead/SDLC.
 * Does not weaken mandatory Security routing (Lead always schedules Security).
 */

export type IntakeStore = {
  load(): Promise<BacklogQueue>;
  save(queue: BacklogQueue): Promise<void>;
};

export function createInMemoryIntakeStore(
  initial?: BacklogQueue,
): IntakeStore {
  let queue = initial ?? createEmptyBacklog();
  return {
    async load() {
      return queue;
    },
    async save(next) {
      queue = next;
    },
  };
}

export function createFileBackedIntakeStore(filePath: string): IntakeStore {
  return {
    async load() {
      try {
        const raw = await readFile(filePath, "utf8");
        return parseBacklogQueue(JSON.parse(raw));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return createEmptyBacklog();
        }
        throw err;
      }
    },
    async save(queue) {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(queue, null, 2)}\n`, "utf8");
    },
  };
}

export type CustomerIntakeOptions = {
  store: IntakeStore;
  lead: LeadOrchestrator;
  defaultTarget?: StartReleaseCheckInput["target"];
};

export class CustomerIntake {
  private readonly store: IntakeStore;
  private readonly lead: LeadOrchestrator;
  private readonly defaultTarget: StartReleaseCheckInput["target"];

  constructor(options: CustomerIntakeOptions) {
    this.store = options.store;
    this.lead = options.lead;
    this.defaultTarget = options.defaultTarget ?? {
      repository: "vishamathur/mvp-releasedesk",
      baseRef: "main",
      headRef: "HEAD",
    };
  }

  async getQueue(): Promise<BacklogQueue> {
    return this.store.load();
  }

  async view(opts?: { customerId?: string }) {
    const queue = await this.store.load();
    return {
      queue,
      items: viewBacklog(queue, opts),
      byCustomer: viewBacklogByCustomer(queue),
      costsByCustomer: sumCostsByCustomer(queue),
    };
  }

  async upsertCustomer(input: UpsertCustomerInput) {
    const queue = await this.store.load();
    const result = upsertCustomer(queue, input);
    await this.store.save(result.queue);
    return result;
  }

  async enqueue(input: EnqueueCustomerRequestInput) {
    const queue = await this.store.load();
    const result = enqueueCustomerRequest(queue, input);
    await this.store.save(result.queue);
    return result;
  }

  async updateRequest(input: UpdateCustomerRequestInput) {
    const queue = await this.store.load();
    const result = updateCustomerRequest(queue, input);
    await this.store.save(result.queue);
    return result;
  }

  async approveQueueItem(
    itemId: string,
    decision: QueueApprovalDecision,
    opts: { decidedBy: string; notes?: string },
  ) {
    const queue = await this.store.load();
    const result = recordQueueApproval(queue, itemId, decision, opts);
    await this.store.save(result.queue);
    return result;
  }

  async approveCost(
    costEstimateId: string,
    decision: Exclude<CostApprovalStatus, "pending">,
    opts: { decidedBy: string; notes?: string },
  ) {
    const queue = await this.store.load();
    const result = recordCostApprovalOnQueue(
      queue,
      costEstimateId,
      decision,
      opts,
    );
    await this.store.save(result.queue);
    return result;
  }

  async reorder(input: ReorderBacklogInput) {
    const queue = await this.store.load();
    const result = reorderBacklog(queue, input);
    await this.store.save(result.queue);
    return result;
  }

  async rebalanceFairness() {
    const queue = await this.store.load();
    const next = rebalanceBacklogFairness(queue);
    await this.store.save(next);
    return next;
  }

  /**
   * Start Lead/SDLC only from a dual-approved backlog item.
   * Blocks when queue approval or cost approval is missing/rejected.
   */
  async startLeadFromApprovedQueueItem(
    itemId: string,
    opts?: {
      target?: StartReleaseCheckInput["target"];
      requestedBy?: string;
      runners?: StartReleaseCheckInput["runners"];
      metadata?: Record<string, unknown>;
    },
  ): Promise<{ report: ReleaseCheckReport; queue: BacklogQueue }> {
    let queue = await this.store.load();
    const item = queue.items.find((i) => i.id === itemId);
    if (!item) throw new Error(`Queue item ${itemId} not found`);

    const cost = getCostForItem(queue, item);
    const request = getRequestForItem(queue, item);
    const gate = canStartLeadFromQueueItem(item, cost);
    if (!gate.ok) {
      queue = appendIntakeAudit(queue, {
        action: "intake.lead_start_blocked",
        message: gate.reason,
        customerId: item.customerId,
        queueItemId: itemId,
        requestId: item.requestId,
        costEstimateId: item.costEstimateId,
      });
      await this.store.save(queue);
      throw new Error(gate.reason);
    }

    const report = await this.lead.startReleaseCheck({
      goal:
        request?.title ??
        `Release check for approved intake item ${itemId}`,
      target: opts?.target ?? this.defaultTarget,
      trigger: {
        kind: "on_demand",
        requestedBy: opts?.requestedBy ?? "intake-approved",
        notes: `Started from dual-approved backlog item ${itemId} (customer ${item.customerId})`,
      },
      runners: opts?.runners,
      metadata: {
        intake: {
          queueItemId: item.id,
          requestId: item.requestId,
          customerId: item.customerId,
          costEstimateId: item.costEstimateId,
          costAmount: cost?.amount,
          costCurrency: cost?.currency,
        },
        ...(opts?.metadata ?? {}),
      },
    });

    // Run is terminal after startReleaseCheck; stamp intake origin on the
    // returned report audit trail (store mutation would hit run_terminal).
    const intakeAudit = createAuditEvent({
      runId: report.runId,
      action: "intake.lead_started_from_queue",
      message: `Lead started from dual-approved intake item ${itemId}`,
      actor: { kind: "agent", agentRole: "lead" },
      details: {
        queueItemId: item.id,
        customerId: item.customerId,
        requestId: item.requestId,
        costEstimateId: item.costEstimateId,
      },
    });
    const reportWithIntake: ReleaseCheckReport = {
      ...report,
      run: {
        ...report.run,
        auditTrail: [...report.run.auditTrail, intakeAudit],
      },
    };

    const marked = markQueueItemInDev(queue, itemId, report.runId);
    await this.store.save(marked.queue);
    return { report: reportWithIntake, queue: marked.queue };
  }

  async markDone(itemId: string) {
    const queue = await this.store.load();
    const result = markQueueItemDone(queue, itemId);
    await this.store.save(result.queue);
    return result;
  }
}

export function createCustomerIntake(
  options: LeadOrchestratorOptions & {
    intakeStore?: IntakeStore;
    defaultTarget?: StartReleaseCheckInput["target"];
  },
): { lead: LeadOrchestrator; intake: CustomerIntake } {
  const lead = new LeadOrchestrator(options);
  const intake = new CustomerIntake({
    store: options.intakeStore ?? createInMemoryIntakeStore(),
    lead,
    ...(options.defaultTarget ? { defaultTarget: options.defaultTarget } : {}),
  });
  return { lead, intake };
}
