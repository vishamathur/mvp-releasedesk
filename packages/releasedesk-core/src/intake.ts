import { z } from "zod";
import { createMockMeta, MockMetaSchema, type MockMeta } from "./mock.js";
import { nowIso } from "./ids.js";

/**
 * Multi-customer intake → weighted prioritized backlog with per-request cost
 * estimates keyed by unique customerId.
 *
 * Dual human gates (queue item + cost record) must clear before Lead/SDLC.
 * Post-approval reorders require a quick human re-prioritize sign-off.
 * Weighting prevents one customer from starving others.
 */

export const QueueItemStatusSchema = z.enum([
  "queued",
  "approved_for_dev",
  "rejected",
  "in_dev",
  "done",
]);

export type QueueItemStatus = z.infer<typeof QueueItemStatusSchema>;

export const CostDirectionSchema = z.enum(["charge", "spend", "credit"]);
export type CostDirection = z.infer<typeof CostDirectionSchema>;

export const CostApprovalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
]);
export type CostApprovalStatus = z.infer<typeof CostApprovalStatusSchema>;

export const QueueApprovalDecisionSchema = z.enum(["approved", "rejected"]);
export type QueueApprovalDecision = z.infer<typeof QueueApprovalDecisionSchema>;

/** Stable unique customer identity — required on customers and cost records. */
export const CustomerIdSchema = z
  .string()
  .regex(/^cust_[a-z0-9][a-z0-9_-]*$/i)
  .min(6);
export type CustomerId = z.infer<typeof CustomerIdSchema>;

export const CustomerRequestIdSchema = z
  .string()
  .regex(/^creq_[a-z0-9_]+$/i);
export type CustomerRequestId = z.infer<typeof CustomerRequestIdSchema>;

export const CostEstimateIdSchema = z
  .string()
  .regex(/^cost_[a-z0-9_]+$/i);
export type CostEstimateId = z.infer<typeof CostEstimateIdSchema>;

export const QueueItemIdSchema = z
  .string()
  .regex(/^qitem_[a-z0-9_]+$/i);
export type QueueItemId = z.infer<typeof QueueItemIdSchema>;

export const BacklogQueueIdSchema = z
  .string()
  .regex(/^backlog_[a-z0-9_]+$/i);
export type BacklogQueueId = z.infer<typeof BacklogQueueIdSchema>;

export const CustomerSchema = z.object({
  customerId: CustomerIdSchema,
  name: z.string().min(1),
  /** Relative fairness weight (default 1). Higher = more share of slots. */
  weight: z.number().positive().default(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
});

export type Customer = z.infer<typeof CustomerSchema>;

export const CustomerRequestSchema = z.object({
  id: CustomerRequestIdSchema,
  customerId: CustomerIdSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  requestedBy: z.string().min(1),
  /** Lower = higher priority hint within the customer's lane. */
  priorityHint: z.number().int().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
});

export type CustomerRequest = z.infer<typeof CustomerRequestSchema>;

export const CostApprovalSchema = z.object({
  status: CostApprovalStatusSchema,
  decidedAt: z.string().datetime().optional(),
  decidedBy: z.string().optional(),
  notes: z.string().optional(),
});

export type CostApproval = z.infer<typeof CostApprovalSchema>;

/**
 * Financial record for monies the company will charge / spend / credit
 * for a customer request. Always tied to customerId (cannot be orphaned).
 * MOCK-labeled when no real billing system.
 */
export const CostEstimateSchema = z
  .object({
    id: CostEstimateIdSchema,
    requestId: CustomerRequestIdSchema,
    /** Required — every cost/billing record is keyed to a customer. */
    customerId: CustomerIdSchema,
    currency: z.string().min(3).max(3).default("USD"),
    amount: z.number().nonnegative(),
    direction: CostDirectionSchema,
    label: z.string().min(1),
    approval: CostApprovalSchema,
    source: z.enum(["mock", "billing_system"]).default("mock"),
    mock: MockMetaSchema.optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    notes: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.customerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cost estimate cannot be orphaned from customerId",
        path: ["customerId"],
      });
    }
  });

export type CostEstimate = z.infer<typeof CostEstimateSchema>;

/** Human gate: approve this backlog item for development. */
export const QueueApprovalSchema = z.object({
  decision: QueueApprovalDecisionSchema,
  decidedAt: z.string().datetime(),
  decidedBy: z.string().min(1),
  notes: z.string().optional(),
});

export type QueueApproval = z.infer<typeof QueueApprovalSchema>;

export const BacklogQueueItemSchema = z.object({
  id: QueueItemIdSchema,
  requestId: CustomerRequestIdSchema,
  customerId: CustomerIdSchema,
  costEstimateId: CostEstimateIdSchema,
  status: QueueItemStatusSchema,
  /** 0-based global position; lower = higher priority. */
  position: z.number().int().nonnegative(),
  queueApproval: QueueApprovalSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  runId: z.string().optional(),
});

export type BacklogQueueItem = z.infer<typeof BacklogQueueItemSchema>;

/** Quick human sign-off required for every backlog reorder. */
export const ReprioritizeSignOffSchema = z.object({
  id: z.string().min(1),
  signedOffBy: z.string().min(1),
  signedOffAt: z.string().datetime(),
  notes: z.string().optional(),
  previousOrder: z.array(QueueItemIdSchema),
  nextOrder: z.array(QueueItemIdSchema),
});

export type ReprioritizeSignOff = z.infer<typeof ReprioritizeSignOffSchema>;

/**
 * Fairness weighting: customers receive interleaving slots proportional to
 * weight so one customer cannot monopolize the sequential backlog.
 */
export const FairnessWeightingSchema = z.object({
  /** Max consecutive items from one customer before rotating (default 1). */
  maxConsecutivePerCustomer: z.number().int().positive().default(1),
  /** When true, apply weighted round-robin on enqueue / rebalance. */
  enabled: z.boolean().default(true),
});

export type FairnessWeighting = z.infer<typeof FairnessWeightingSchema>;

export const DEFAULT_FAIRNESS_WEIGHTING: FairnessWeighting = {
  maxConsecutivePerCustomer: 1,
  enabled: true,
};

export const IntakeAuditActionSchema = z.enum([
  "intake.customer_upserted",
  "intake.request_created",
  "intake.request_updated",
  "intake.cost_created",
  "intake.cost_updated",
  "intake.cost_approval_recorded",
  "intake.enqueued",
  "intake.queue_approval_recorded",
  "intake.reordered",
  "intake.reprioritize_signoff_recorded",
  "intake.fairness_rebalanced",
  "intake.lead_start_blocked",
  "intake.lead_started",
  "intake.item_status_changed",
]);

export type IntakeAuditAction = z.infer<typeof IntakeAuditActionSchema>;

export const IntakeAuditEventSchema = z.object({
  id: z.string().min(1),
  queueId: BacklogQueueIdSchema,
  action: IntakeAuditActionSchema,
  at: z.string().datetime(),
  actor: z.object({
    kind: z.enum(["system", "agent", "human"]),
    name: z.string().optional(),
  }),
  message: z.string().min(1),
  customerId: CustomerIdSchema.optional(),
  requestId: CustomerRequestIdSchema.optional(),
  queueItemId: QueueItemIdSchema.optional(),
  costEstimateId: CostEstimateIdSchema.optional(),
  details: z.record(z.unknown()).optional(),
});

export type IntakeAuditEvent = z.infer<typeof IntakeAuditEventSchema>;

export const BacklogQueueSchema = z.object({
  id: BacklogQueueIdSchema,
  name: z.string().min(1).default("Customer intake backlog"),
  customers: z.array(CustomerSchema).default([]),
  requests: z.array(CustomerRequestSchema).default([]),
  costEstimates: z.array(CostEstimateSchema).default([]),
  items: z.array(BacklogQueueItemSchema).default([]),
  reorderHistory: z.array(ReprioritizeSignOffSchema).default([]),
  fairness: FairnessWeightingSchema.default(DEFAULT_FAIRNESS_WEIGHTING),
  auditTrail: z.array(IntakeAuditEventSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type BacklogQueue = z.infer<typeof BacklogQueueSchema>;

let customerSeq = 0;
let requestSeq = 0;
let costSeq = 0;
let itemSeq = 0;
let backlogSeq = 0;
let auditSeq = 0;
let reorderSeq = 0;

export function createCustomerId(seed?: string): CustomerId {
  customerSeq += 1;
  const raw = (seed ?? `c${customerSeq}`).toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return CustomerIdSchema.parse(`cust_${raw || customerSeq}`);
}

export function createCustomerRequestId(seed?: string): CustomerRequestId {
  requestSeq += 1;
  return `creq_${seed ?? requestSeq}_${Date.now()}`;
}

export function createCostEstimateId(seed?: string): CostEstimateId {
  costSeq += 1;
  return `cost_${seed ?? costSeq}_${Date.now()}`;
}

export function createQueueItemId(seed?: string): QueueItemId {
  itemSeq += 1;
  return `qitem_${seed ?? itemSeq}_${Date.now()}`;
}

export function createBacklogQueueId(seed?: string): BacklogQueueId {
  backlogSeq += 1;
  return `backlog_${seed ?? backlogSeq}_${Date.now()}`;
}

export function createEmptyBacklog(opts?: {
  id?: string;
  name?: string;
  fairness?: Partial<FairnessWeighting>;
}): BacklogQueue {
  const at = nowIso();
  return BacklogQueueSchema.parse({
    id: opts?.id ?? createBacklogQueueId(),
    name: opts?.name ?? "Customer intake backlog",
    customers: [],
    requests: [],
    costEstimates: [],
    items: [],
    reorderHistory: [],
    fairness: { ...DEFAULT_FAIRNESS_WEIGHTING, ...(opts?.fairness ?? {}) },
    auditTrail: [],
    createdAt: at,
    updatedAt: at,
  });
}

export function appendIntakeAudit(
  queue: BacklogQueue,
  input: {
    action: IntakeAuditAction;
    message: string;
    actor?: IntakeAuditEvent["actor"];
    customerId?: string;
    requestId?: string;
    queueItemId?: string;
    costEstimateId?: string;
    details?: Record<string, unknown>;
  },
): BacklogQueue {
  auditSeq += 1;
  const event = IntakeAuditEventSchema.parse({
    id: `iaud_${auditSeq}_${Date.now()}`,
    queueId: queue.id,
    action: input.action,
    at: nowIso(),
    actor: input.actor ?? { kind: "system" },
    message: input.message,
    ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    ...(input.queueItemId !== undefined
      ? { queueItemId: input.queueItemId }
      : {}),
    ...(input.costEstimateId !== undefined
      ? { costEstimateId: input.costEstimateId }
      : {}),
    ...(input.details !== undefined ? { details: input.details } : {}),
  });
  return BacklogQueueSchema.parse({
    ...queue,
    auditTrail: [...queue.auditTrail, event],
    updatedAt: nowIso(),
  });
}

export type UpsertCustomerInput = {
  customerId?: string;
  name: string;
  weight?: number;
  metadata?: Record<string, unknown>;
};

export function upsertCustomer(
  queue: BacklogQueue,
  input: UpsertCustomerInput,
): { queue: BacklogQueue; customer: Customer } {
  const customerId = input.customerId
    ? CustomerIdSchema.parse(input.customerId)
    : createCustomerId(input.name);
  const existing = queue.customers.find((c) => c.customerId === customerId);
  const at = nowIso();
  const customer = CustomerSchema.parse({
    customerId,
    name: input.name,
    weight: input.weight ?? existing?.weight ?? 1,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    ...(input.metadata !== undefined
      ? { metadata: input.metadata }
      : existing?.metadata !== undefined
        ? { metadata: existing.metadata }
        : {}),
  });

  const customers = existing
    ? queue.customers.map((c) =>
        c.customerId === customerId ? customer : c,
      )
    : [...queue.customers, customer];

  let next = BacklogQueueSchema.parse({
    ...queue,
    customers,
    updatedAt: at,
  });
  next = appendIntakeAudit(next, {
    action: "intake.customer_upserted",
    message: `Customer ${customer.name} (${customer.customerId}) upserted`,
    customerId: customer.customerId,
    details: { weight: customer.weight },
  });
  return { queue: next, customer };
}

export function requireCustomer(
  queue: BacklogQueue,
  customerId: string,
): Customer {
  const customer = queue.customers.find((c) => c.customerId === customerId);
  if (!customer) {
    throw new Error(`Unknown customerId ${customerId}; upsert customer first`);
  }
  return customer;
}

export type CreateCustomerRequestInput = {
  customerId: string;
  title: string;
  summary: string;
  requestedBy: string;
  priorityHint?: number;
  metadata?: Record<string, unknown>;
  id?: string;
};

export function createCustomerRequest(
  input: CreateCustomerRequestInput,
): CustomerRequest {
  const at = nowIso();
  return CustomerRequestSchema.parse({
    id: input.id ?? createCustomerRequestId(),
    customerId: CustomerIdSchema.parse(input.customerId),
    title: input.title,
    summary: input.summary,
    requestedBy: input.requestedBy,
    ...(input.priorityHint !== undefined
      ? { priorityHint: input.priorityHint }
      : {}),
    createdAt: at,
    updatedAt: at,
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  });
}

export type CreateCostEstimateInput = {
  requestId: string;
  /** Required — cost cannot be orphaned from its customer. */
  customerId: string;
  amount: number;
  currency?: string;
  direction: CostDirection;
  label?: string;
  notes?: string;
  source?: "mock" | "billing_system";
  mock?: MockMeta;
  id?: string;
};

export function createCostEstimate(input: CreateCostEstimateInput): CostEstimate {
  if (!input.customerId) {
    throw new Error("Cost estimate cannot be orphaned from customerId");
  }
  const at = nowIso();
  const source = input.source ?? "mock";
  const mock =
    source === "mock"
      ? (input.mock ??
        createMockMeta(
          "billing",
          "No real billing system — estimate is MOCK",
        ))
      : input.mock;

  return CostEstimateSchema.parse({
    id: input.id ?? createCostEstimateId(),
    requestId: input.requestId,
    customerId: CustomerIdSchema.parse(input.customerId),
    currency: input.currency ?? "USD",
    amount: input.amount,
    direction: input.direction,
    label: input.label ?? `Estimate for ${input.requestId}`,
    approval: { status: "pending" },
    source,
    ...(mock !== undefined ? { mock } : {}),
    createdAt: at,
    updatedAt: at,
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  });
}

export function assertCostTiedToCustomer(
  estimate: CostEstimate,
  customerId: string,
): void {
  if (estimate.customerId !== customerId) {
    throw new Error(
      `Cost estimate ${estimate.id} customerId ${estimate.customerId} does not match ${customerId}`,
    );
  }
}

export function updateCostEstimate(
  estimate: CostEstimate,
  patch: Partial<
    Pick<CostEstimate, "amount" | "currency" | "direction" | "label" | "notes">
  >,
): CostEstimate {
  if (estimate.approval.status === "approved") {
    throw new Error(
      `Cost estimate ${estimate.id} is already approved; create a new revision instead of mutating`,
    );
  }
  // customerId is immutable — never allow orphaning / reassignment via patch
  return CostEstimateSchema.parse({
    ...estimate,
    ...patch,
    customerId: estimate.customerId,
    approval: { status: "pending" },
    updatedAt: nowIso(),
  });
}

export function recordCostApproval(
  estimate: CostEstimate,
  decision: Exclude<CostApprovalStatus, "pending">,
  opts: { decidedBy: string; notes?: string },
): CostEstimate {
  if (estimate.approval.status !== "pending") {
    throw new Error(
      `Cost estimate ${estimate.id} approval is already ${estimate.approval.status}`,
    );
  }
  return CostEstimateSchema.parse({
    ...estimate,
    customerId: estimate.customerId,
    approval: {
      status: decision,
      decidedAt: nowIso(),
      decidedBy: opts.decidedBy,
      ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
    },
    updatedAt: nowIso(),
  });
}

export function isCostApproved(estimate: CostEstimate | undefined): boolean {
  return estimate?.approval.status === "approved";
}

/**
 * Both cost-record approval and queue-item approval must be approved
 * before Lead may start from this item.
 */
export function canStartLeadFromQueueItem(
  item: BacklogQueueItem,
  estimate: CostEstimate | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (item.status === "rejected") {
    return { ok: false, reason: `Queue item ${item.id} is rejected` };
  }
  if (item.status === "in_dev" || item.status === "done") {
    return {
      ok: false,
      reason: `Queue item ${item.id} is already ${item.status}`,
    };
  }
  if (item.queueApproval?.decision !== "approved") {
    return {
      ok: false,
      reason: `Queue item ${item.id} lacks human queue_approval for development`,
    };
  }
  if (!estimate) {
    return {
      ok: false,
      reason: `Cost estimate ${item.costEstimateId} not found for queue item ${item.id}`,
    };
  }
  if (estimate.customerId !== item.customerId) {
    return {
      ok: false,
      reason: `Cost estimate ${estimate.id} customerId mismatch with queue item`,
    };
  }
  if (estimate.approval.status !== "approved") {
    return {
      ok: false,
      reason: `Cost estimate ${estimate.id} lacks human cost approval (status=${estimate.approval.status})`,
    };
  }
  if (item.status !== "approved_for_dev") {
    return {
      ok: false,
      reason: `Queue item ${item.id} status is ${item.status}; expected approved_for_dev`,
    };
  }
  return { ok: true };
}

export function deriveQueueItemStatus(input: {
  queueDecision?: QueueApprovalDecision;
  costStatus: CostApprovalStatus;
  current?: QueueItemStatus;
}): QueueItemStatus {
  if (input.current === "in_dev" || input.current === "done") {
    return input.current;
  }
  if (input.queueDecision === "rejected" || input.costStatus === "rejected") {
    return "rejected";
  }
  if (input.queueDecision === "approved" && input.costStatus === "approved") {
    return "approved_for_dev";
  }
  return "queued";
}

/**
 * Weighted round-robin interleaving so no customer starves others.
 * Within each customer lane, preserve relative order (priorityHint / enqueue).
 */
export function applyFairnessOrdering(
  items: readonly BacklogQueueItem[],
  customers: readonly Customer[],
  fairness: FairnessWeighting = DEFAULT_FAIRNESS_WEIGHTING,
): BacklogQueueItem[] {
  const active = items.filter((i) => i.status !== "done");
  const done = items.filter((i) => i.status === "done");
  if (!fairness.enabled || active.length <= 1) {
    return [
      ...active.map((it, position) => ({ ...it, position })),
      ...done,
    ];
  }

  const weightById = new Map(
    customers.map((c) => [c.customerId, Math.max(0.0001, c.weight)]),
  );
  const lanes = new Map<string, BacklogQueueItem[]>();
  for (const item of [...active].sort((a, b) => a.position - b.position)) {
    const lane = lanes.get(item.customerId) ?? [];
    lane.push(item);
    lanes.set(item.customerId, lane);
  }

  const customerIds = [...lanes.keys()];
  const quotas = new Map(
    customerIds.map((id) => [
      id,
      Math.max(1, Math.round(weightById.get(id) ?? 1)),
    ]),
  );
  const remaining = new Map(
    customerIds.map((id) => [id, [...(lanes.get(id) ?? [])]]),
  );

  const result: BacklogQueueItem[] = [];
  let consecutive = 0;
  let lastCustomer: string | undefined;
  const maxConsecutive = fairness.maxConsecutivePerCustomer;

  while (result.length < active.length) {
    const candidates = customerIds
      .filter((id) => (remaining.get(id)?.length ?? 0) > 0)
      .sort((a, b) => {
        // Prefer customers who haven't gone consecutively over the limit
        const aBlocked =
          lastCustomer === a && consecutive >= maxConsecutive * (quotas.get(a) ?? 1);
        const bBlocked =
          lastCustomer === b && consecutive >= maxConsecutive * (quotas.get(b) ?? 1);
        if (aBlocked !== bBlocked) return aBlocked ? 1 : -1;
        // Prefer under-served (fewer items taken relative to weight)
        const aTaken =
          (lanes.get(a)?.length ?? 0) - (remaining.get(a)?.length ?? 0);
        const bTaken =
          (lanes.get(b)?.length ?? 0) - (remaining.get(b)?.length ?? 0);
        const aShare = aTaken / (quotas.get(a) ?? 1);
        const bShare = bTaken / (quotas.get(b) ?? 1);
        if (aShare !== bShare) return aShare - bShare;
        return a.localeCompare(b);
      });

    const pick = candidates[0];
    if (!pick) break;
    const lane = remaining.get(pick)!;
    const nextItem = lane.shift()!;
    remaining.set(pick, lane);
    result.push(nextItem);
    if (lastCustomer === pick) consecutive += 1;
    else {
      lastCustomer = pick;
      consecutive = 1;
    }
  }

  const at = nowIso();
  return [
    ...result.map((it, position) =>
      BacklogQueueItemSchema.parse({ ...it, position, updatedAt: at }),
    ),
    ...done,
  ];
}

export function rebalanceBacklogFairness(queue: BacklogQueue): BacklogQueue {
  const items = applyFairnessOrdering(
    queue.items,
    queue.customers,
    queue.fairness,
  );
  let next = BacklogQueueSchema.parse({
    ...queue,
    items,
    updatedAt: nowIso(),
  });
  next = appendIntakeAudit(next, {
    action: "intake.fairness_rebalanced",
    message: "Backlog rebalanced with multi-customer fairness weighting",
    details: {
      fairness: queue.fairness,
      order: items
        .filter((i) => i.status !== "done")
        .map((i) => ({ id: i.id, customerId: i.customerId, position: i.position })),
    },
  });
  return next;
}

export type EnqueueCustomerRequestInput = {
  /** Existing customerId, or provide customer upsert fields. */
  customerId?: string;
  customer?: UpsertCustomerInput;
  request: Omit<CreateCustomerRequestInput, "customerId">;
  cost: Omit<CreateCostEstimateInput, "requestId" | "customerId">;
  /** When true (default), rebalance with fairness after enqueue. */
  applyFairness?: boolean;
};

/**
 * Create/ensure customer → request + cost (keyed by customerId) + queue item.
 */
export function enqueueCustomerRequest(
  queue: BacklogQueue,
  input: EnqueueCustomerRequestInput,
): {
  queue: BacklogQueue;
  customer: Customer;
  request: CustomerRequest;
  cost: CostEstimate;
  item: BacklogQueueItem;
} {
  let next = queue;
  let customer: Customer;

  if (input.customer) {
    const upserted = upsertCustomer(next, {
      ...input.customer,
      ...(input.customerId ? { customerId: input.customerId } : {}),
    });
    next = upserted.queue;
    customer = upserted.customer;
  } else if (input.customerId) {
    customer = requireCustomer(next, input.customerId);
  } else {
    throw new Error("enqueueCustomerRequest requires customerId or customer");
  }

  const request = createCustomerRequest({
    ...input.request,
    customerId: customer.customerId,
  });
  const cost = createCostEstimate({
    ...input.cost,
    requestId: request.id,
    customerId: customer.customerId,
  });
  assertCostTiedToCustomer(cost, customer.customerId);

  const at = nowIso();
  const item = BacklogQueueItemSchema.parse({
    id: createQueueItemId(),
    requestId: request.id,
    customerId: customer.customerId,
    costEstimateId: cost.id,
    status: "queued",
    position: next.items.filter((i) => i.status !== "done").length,
    createdAt: at,
    updatedAt: at,
  });

  next = BacklogQueueSchema.parse({
    ...next,
    requests: [...next.requests, request],
    costEstimates: [...next.costEstimates, cost],
    items: [...next.items, item],
    updatedAt: at,
  });

  next = appendIntakeAudit(next, {
    action: "intake.request_created",
    message: `Customer request created: ${request.title}`,
    customerId: customer.customerId,
    requestId: request.id,
    actor: { kind: "human", name: request.requestedBy },
  });
  next = appendIntakeAudit(next, {
    action: "intake.cost_created",
    message: `Cost estimate ${cost.amount} ${cost.currency} (${cost.direction}) for ${customer.customerId}${
      cost.source === "mock" ? " [MOCK]" : ""
    }`,
    customerId: customer.customerId,
    requestId: request.id,
    costEstimateId: cost.id,
    details: {
      amount: cost.amount,
      currency: cost.currency,
      direction: cost.direction,
      source: cost.source,
      customerId: cost.customerId,
      mock: Boolean(cost.mock?.mocked),
    },
  });
  next = appendIntakeAudit(next, {
    action: "intake.enqueued",
    message: `Enqueued request for ${customer.customerId}`,
    customerId: customer.customerId,
    requestId: request.id,
    queueItemId: item.id,
    costEstimateId: cost.id,
  });

  if (input.applyFairness !== false) {
    next = rebalanceBacklogFairness(next);
  }

  return {
    queue: next,
    customer,
    request,
    cost: next.costEstimates.find((c) => c.id === cost.id)!,
    item: next.items.find((i) => i.id === item.id)!,
  };
}

export type UpdateCustomerRequestInput = {
  requestId: string;
  patch: Partial<
    Pick<CustomerRequest, "title" | "summary" | "priorityHint" | "metadata">
  >;
  costPatch?: Partial<
    Pick<CostEstimate, "amount" | "currency" | "direction" | "label" | "notes">
  >;
};

export function updateCustomerRequest(
  queue: BacklogQueue,
  input: UpdateCustomerRequestInput,
): {
  queue: BacklogQueue;
  request: CustomerRequest;
  cost?: CostEstimate;
} {
  const idx = queue.requests.findIndex((r) => r.id === input.requestId);
  if (idx < 0) throw new Error(`Customer request ${input.requestId} not found`);

  const existing = queue.requests[idx]!;
  const request = CustomerRequestSchema.parse({
    ...existing,
    ...input.patch,
    customerId: existing.customerId,
    updatedAt: nowIso(),
  });

  if (input.costPatch) {
    const costIdx = queue.costEstimates.findIndex(
      (c) => c.requestId === input.requestId,
    );
    if (costIdx < 0) {
      throw new Error(`Cost estimate for request ${input.requestId} not found`);
    }
    const existingCost = queue.costEstimates[costIdx]!;
    assertCostTiedToCustomer(existingCost, request.customerId);
    const updatedCost = updateCostEstimate(existingCost, input.costPatch);
    assertCostTiedToCustomer(updatedCost, request.customerId);

    const items = queue.items.map((item) => {
      if (item.requestId !== input.requestId) return item;
      if (item.status === "in_dev" || item.status === "done") return item;
      const status = deriveQueueItemStatus({
        queueDecision: item.queueApproval?.decision,
        costStatus: "pending",
        current: item.status,
      });
      return BacklogQueueItemSchema.parse({
        ...item,
        status,
        updatedAt: nowIso(),
      });
    });

    let next = BacklogQueueSchema.parse({
      ...queue,
      requests: queue.requests.map((r, i) => (i === idx ? request : r)),
      costEstimates: queue.costEstimates.map((c, i) =>
        i === costIdx ? updatedCost : c,
      ),
      items,
      updatedAt: nowIso(),
    });
    next = appendIntakeAudit(next, {
      action: "intake.request_updated",
      message: `Customer request updated: ${request.title}`,
      customerId: request.customerId,
      requestId: request.id,
    });
    next = appendIntakeAudit(next, {
      action: "intake.cost_updated",
      message: `Cost estimate updated for ${request.customerId}; approval reset to pending`,
      customerId: request.customerId,
      requestId: request.id,
      costEstimateId: updatedCost.id,
      details: { ...input.costPatch, customerId: updatedCost.customerId },
    });
    return { queue: next, request, cost: updatedCost };
  }

  let next = BacklogQueueSchema.parse({
    ...queue,
    requests: queue.requests.map((r, i) => (i === idx ? request : r)),
    updatedAt: nowIso(),
  });
  next = appendIntakeAudit(next, {
    action: "intake.request_updated",
    message: `Customer request updated: ${request.title}`,
    customerId: request.customerId,
    requestId: request.id,
  });
  return { queue: next, request };
}

export function recordQueueApproval(
  queue: BacklogQueue,
  itemId: string,
  decision: QueueApprovalDecision,
  opts: { decidedBy: string; notes?: string },
): { queue: BacklogQueue; item: BacklogQueueItem } {
  const item = queue.items.find((i) => i.id === itemId);
  if (!item) throw new Error(`Queue item ${itemId} not found`);
  if (item.status === "in_dev" || item.status === "done") {
    throw new Error(`Queue item ${itemId} is already ${item.status}`);
  }
  if (item.queueApproval) {
    throw new Error(
      `Queue item ${itemId} already has queue_approval=${item.queueApproval.decision}`,
    );
  }

  const cost = queue.costEstimates.find((c) => c.id === item.costEstimateId);
  const costStatus = cost?.approval.status ?? "pending";
  const status = deriveQueueItemStatus({
    queueDecision: decision,
    costStatus,
    current: item.status,
  });

  const nextItem = BacklogQueueItemSchema.parse({
    ...item,
    queueApproval: {
      decision,
      decidedAt: nowIso(),
      decidedBy: opts.decidedBy,
      ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
    },
    status,
    updatedAt: nowIso(),
  });

  let next = BacklogQueueSchema.parse({
    ...queue,
    items: queue.items.map((i) => (i.id === itemId ? nextItem : i)),
    updatedAt: nowIso(),
  });
  next = appendIntakeAudit(next, {
    action: "intake.queue_approval_recorded",
    message: `Queue approval ${decision} by ${opts.decidedBy}; status→${status}`,
    actor: { kind: "human", name: opts.decidedBy },
    customerId: item.customerId,
    requestId: item.requestId,
    queueItemId: itemId,
    costEstimateId: item.costEstimateId,
    details: { decision, status, costStatus },
  });
  next = appendIntakeAudit(next, {
    action: "intake.item_status_changed",
    message: `Queue item status ${item.status} → ${status}`,
    customerId: item.customerId,
    queueItemId: itemId,
    requestId: item.requestId,
    details: { from: item.status, to: status },
  });

  return { queue: next, item: nextItem };
}

export function recordCostApprovalOnQueue(
  queue: BacklogQueue,
  costEstimateId: string,
  decision: Exclude<CostApprovalStatus, "pending">,
  opts: { decidedBy: string; notes?: string },
): { queue: BacklogQueue; cost: CostEstimate; item?: BacklogQueueItem } {
  const costIdx = queue.costEstimates.findIndex((c) => c.id === costEstimateId);
  if (costIdx < 0) {
    throw new Error(`Cost estimate ${costEstimateId} not found`);
  }
  const existing = queue.costEstimates[costIdx]!;
  if (!existing.customerId) {
    throw new Error(`Cost estimate ${costEstimateId} is orphaned from customerId`);
  }
  requireCustomer(queue, existing.customerId);
  const cost = recordCostApproval(existing, decision, opts);

  const items = queue.items.map((item) => {
    if (item.costEstimateId !== costEstimateId) return item;
    if (item.status === "in_dev" || item.status === "done") return item;
    const status = deriveQueueItemStatus({
      queueDecision: item.queueApproval?.decision,
      costStatus: decision,
      current: item.status,
    });
    return BacklogQueueItemSchema.parse({
      ...item,
      status,
      updatedAt: nowIso(),
    });
  });

  let next = BacklogQueueSchema.parse({
    ...queue,
    costEstimates: queue.costEstimates.map((c, i) =>
      i === costIdx ? cost : c,
    ),
    items,
    updatedAt: nowIso(),
  });
  next = appendIntakeAudit(next, {
    action: "intake.cost_approval_recorded",
    message: `Cost approval ${decision} by ${opts.decidedBy} for ${cost.customerId}`,
    actor: { kind: "human", name: opts.decidedBy },
    customerId: cost.customerId,
    requestId: cost.requestId,
    costEstimateId: cost.id,
    details: {
      decision,
      amount: cost.amount,
      currency: cost.currency,
      customerId: cost.customerId,
    },
  });

  const linked = next.items.find((i) => i.costEstimateId === costEstimateId);
  if (linked) {
    next = appendIntakeAudit(next, {
      action: "intake.item_status_changed",
      message: `Queue item status → ${linked.status} after cost approval`,
      customerId: linked.customerId,
      queueItemId: linked.id,
      requestId: linked.requestId,
      costEstimateId: cost.id,
      details: { to: linked.status },
    });
  }

  return { queue: next, cost, ...(linked ? { item: linked } : {}) };
}

export type ReorderBacklogInput = {
  orderedItemIds: string[];
  signOff?: {
    signedOffBy: string;
    notes?: string;
  };
};

/**
 * Reorder the prioritized backlog. Rejects without a human re-prioritize sign-off.
 */
export function reorderBacklog(
  queue: BacklogQueue,
  input: ReorderBacklogInput,
): { queue: BacklogQueue; signOff: ReprioritizeSignOff } {
  if (!input.signOff?.signedOffBy) {
    throw new Error(
      "Backlog reorder rejected: human re-prioritize sign-off is required",
    );
  }

  const sortable = queue.items
    .filter((i) => i.status !== "done")
    .sort((a, b) => a.position - b.position);
  const doneItems = queue.items.filter((i) => i.status === "done");

  const sortableIds = new Set(sortable.map((i) => i.id));
  if (input.orderedItemIds.length !== sortable.length) {
    throw new Error(
      `Reorder must include all ${sortable.length} non-done items; got ${input.orderedItemIds.length}`,
    );
  }
  for (const id of input.orderedItemIds) {
    if (!sortableIds.has(id)) {
      throw new Error(`Unknown or done queue item in reorder: ${id}`);
    }
  }

  const previousOrder = sortable.map((i) => i.id);
  const byId = new Map(sortable.map((i) => [i.id, i]));
  const at = nowIso();
  const reordered = input.orderedItemIds.map((id, position) =>
    BacklogQueueItemSchema.parse({
      ...byId.get(id)!,
      position,
      updatedAt: at,
    }),
  );

  reorderSeq += 1;
  const signOff = ReprioritizeSignOffSchema.parse({
    id: `repri_${reorderSeq}_${Date.now()}`,
    signedOffBy: input.signOff.signedOffBy,
    signedOffAt: at,
    ...(input.signOff.notes !== undefined
      ? { notes: input.signOff.notes }
      : {}),
    previousOrder,
    nextOrder: input.orderedItemIds,
  });

  let next = BacklogQueueSchema.parse({
    ...queue,
    items: [...reordered, ...doneItems],
    reorderHistory: [...queue.reorderHistory, signOff],
    updatedAt: at,
  });
  next = appendIntakeAudit(next, {
    action: "intake.reprioritize_signoff_recorded",
    message: `Re-prioritize signed off by ${signOff.signedOffBy}`,
    actor: { kind: "human", name: signOff.signedOffBy },
    details: { previousOrder, nextOrder: input.orderedItemIds },
  });
  next = appendIntakeAudit(next, {
    action: "intake.reordered",
    message: "Backlog reordered after human sign-off",
    actor: { kind: "human", name: signOff.signedOffBy },
    details: { signOffId: signOff.id },
  });

  return { queue: next, signOff };
}

export function markQueueItemInDev(
  queue: BacklogQueue,
  itemId: string,
  runId: string,
): { queue: BacklogQueue; item: BacklogQueueItem } {
  const item = queue.items.find((i) => i.id === itemId);
  if (!item) throw new Error(`Queue item ${itemId} not found`);
  const cost = queue.costEstimates.find((c) => c.id === item.costEstimateId);
  const gate = canStartLeadFromQueueItem(item, cost);
  if (!gate.ok) {
    let blocked = appendIntakeAudit(queue, {
      action: "intake.lead_start_blocked",
      message: gate.reason,
      customerId: item.customerId,
      queueItemId: itemId,
      requestId: item.requestId,
      costEstimateId: item.costEstimateId,
    });
    void blocked;
    throw new Error(gate.reason);
  }

  const nextItem = BacklogQueueItemSchema.parse({
    ...item,
    status: "in_dev",
    runId,
    updatedAt: nowIso(),
  });

  let next = BacklogQueueSchema.parse({
    ...queue,
    items: queue.items.map((i) => (i.id === itemId ? nextItem : i)),
    updatedAt: nowIso(),
  });
  next = appendIntakeAudit(next, {
    action: "intake.lead_started",
    message: `Lead started from dual-approved queue item; run ${runId}`,
    customerId: item.customerId,
    queueItemId: itemId,
    requestId: item.requestId,
    costEstimateId: item.costEstimateId,
    details: { runId },
  });
  next = appendIntakeAudit(next, {
    action: "intake.item_status_changed",
    message: `Queue item status approved_for_dev → in_dev`,
    customerId: item.customerId,
    queueItemId: itemId,
    details: { runId },
  });

  return { queue: next, item: nextItem };
}

export function markQueueItemDone(
  queue: BacklogQueue,
  itemId: string,
): { queue: BacklogQueue; item: BacklogQueueItem } {
  const item = queue.items.find((i) => i.id === itemId);
  if (!item) throw new Error(`Queue item ${itemId} not found`);
  if (item.status !== "in_dev") {
    throw new Error(`Queue item ${itemId} is ${item.status}; expected in_dev`);
  }
  const nextItem = BacklogQueueItemSchema.parse({
    ...item,
    status: "done",
    updatedAt: nowIso(),
  });
  let next = BacklogQueueSchema.parse({
    ...queue,
    items: queue.items.map((i) => (i.id === itemId ? nextItem : i)),
    updatedAt: nowIso(),
  });
  next = appendIntakeAudit(next, {
    action: "intake.item_status_changed",
    message: `Queue item status in_dev → done`,
    customerId: item.customerId,
    queueItemId: itemId,
    requestId: item.requestId,
  });
  return { queue: next, item: nextItem };
}

export function listBacklogInPriorityOrder(
  queue: BacklogQueue,
): BacklogQueueItem[] {
  return [...queue.items].sort((a, b) => a.position - b.position);
}

export function getRequestForItem(
  queue: BacklogQueue,
  item: BacklogQueueItem,
): CustomerRequest | undefined {
  return queue.requests.find((r) => r.id === item.requestId);
}

export function getCostForItem(
  queue: BacklogQueue,
  item: BacklogQueueItem,
): CostEstimate | undefined {
  return queue.costEstimates.find((c) => c.id === item.costEstimateId);
}

export function getCustomer(
  queue: BacklogQueue,
  customerId: string,
): Customer | undefined {
  return queue.customers.find((c) => c.customerId === customerId);
}

export type BacklogViewItem = {
  item: BacklogQueueItem;
  customer: Customer;
  request: CustomerRequest;
  cost: CostEstimate;
  leadReady: boolean;
  blockReason?: string;
};

export function viewBacklog(
  queue: BacklogQueue,
  opts?: { customerId?: string },
): BacklogViewItem[] {
  return listBacklogInPriorityOrder(queue)
    .filter((item) =>
      opts?.customerId ? item.customerId === opts.customerId : true,
    )
    .map((item) => {
      const customer = getCustomer(queue, item.customerId);
      const request = getRequestForItem(queue, item);
      const cost = getCostForItem(queue, item);
      if (!customer || !request || !cost) {
        throw new Error(`Backlog item ${item.id} missing customer/request/cost`);
      }
      if (cost.customerId !== item.customerId) {
        throw new Error(
          `Cost estimate ${cost.id} orphaned/mismatched customerId for item ${item.id}`,
        );
      }
      const gate = canStartLeadFromQueueItem(item, cost);
      return {
        item,
        customer,
        request,
        cost,
        leadReady: gate.ok,
        ...(gate.ok ? {} : { blockReason: gate.reason }),
      };
    });
}

/** Per-customer backlog slices for multi-customer UI. */
export function viewBacklogByCustomer(
  queue: BacklogQueue,
): Record<string, BacklogViewItem[]> {
  const out: Record<string, BacklogViewItem[]> = {};
  for (const customer of queue.customers) {
    out[customer.customerId] = viewBacklog(queue, {
      customerId: customer.customerId,
    });
  }
  return out;
}

/** Sum of cost estimates per customerId (per-customer cost tracking). */
export function sumCostsByCustomer(
  queue: BacklogQueue,
): Record<
  string,
  { customerId: string; currency: string; totalAmount: number; count: number }
> {
  const out: Record<
    string,
    { customerId: string; currency: string; totalAmount: number; count: number }
  > = {};
  for (const cost of queue.costEstimates) {
    if (!cost.customerId) {
      throw new Error(`Cost estimate ${cost.id} is orphaned from customerId`);
    }
    const cur = out[cost.customerId] ?? {
      customerId: cost.customerId,
      currency: cost.currency,
      totalAmount: 0,
      count: 0,
    };
    cur.totalAmount += cost.amount;
    cur.count += 1;
    out[cost.customerId] = cur;
  }
  return out;
}

export function parseBacklogQueue(raw: unknown): BacklogQueue {
  return BacklogQueueSchema.parse(raw);
}
