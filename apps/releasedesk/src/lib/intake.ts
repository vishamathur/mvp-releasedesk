import path from "node:path";
import {
  FileBackedRunContextStore,
  type BacklogViewItem,
} from "@releasedesk/core";
import {
  createCustomerIntake,
  createDefaultStubRunners,
  createFileBackedIntakeStore,
  createMockPrClient,
  type CustomerIntake,
} from "@releasedesk/lead";
import { wrapDeskReport, writeDeskReport } from "./desk";

function resolveAppRoot(): string {
  if (
    process.cwd().endsWith(`${path.sep}releasedesk`) ||
    process.cwd().endsWith("/releasedesk")
  ) {
    return process.cwd();
  }
  return path.join(process.cwd(), "apps", "releasedesk");
}

function intakePaths() {
  const root = resolveAppRoot();
  return {
    root,
    data: path.join(root, "data"),
    backlogFile: path.join(root, "data", "intake-backlog.json"),
    storeFile: path.join(root, "data", "runs.json"),
  };
}

export function createDeskIntake(): CustomerIntake {
  const p = intakePaths();
  const { intake } = createCustomerIntake({
    store: new FileBackedRunContextStore(p.storeFile),
    intakeStore: createFileBackedIntakeStore(p.backlogFile),
    runners: createDefaultStubRunners(),
    enableRemediation: false,
    maxRemediationCycles: 0,
    prClient: { client: createMockPrClient() },
  });
  return intake;
}

export type IntakeListResponse = {
  items: BacklogViewItem[];
  byCustomer: Record<string, BacklogViewItem[]>;
  costsByCustomer: Record<
    string,
    { customerId: string; currency: string; totalAmount: number; count: number }
  >;
  customers: Array<{ customerId: string; name: string; weight: number }>;
};

export async function getIntakeList(
  customerId?: string,
): Promise<IntakeListResponse> {
  const intake = createDeskIntake();
  const view = await intake.view(customerId ? { customerId } : undefined);
  return {
    items: view.items,
    byCustomer: view.byCustomer,
    costsByCustomer: view.costsByCustomer,
    customers: view.queue.customers.map((c) => ({
      customerId: c.customerId,
      name: c.name,
      weight: c.weight,
    })),
  };
}

export async function enqueueIntakeRequest(input: {
  customerId?: string;
  customerName: string;
  customerWeight?: number;
  title: string;
  summary: string;
  requestedBy?: string;
  amount: number;
  currency?: string;
  direction?: "charge" | "spend" | "credit";
}) {
  const intake = createDeskIntake();
  return intake.enqueue({
    customer: {
      ...(input.customerId ? { customerId: input.customerId } : {}),
      name: input.customerName,
      ...(input.customerWeight !== undefined
        ? { weight: input.customerWeight }
        : {}),
    },
    request: {
      title: input.title,
      summary: input.summary,
      requestedBy: input.requestedBy ?? "delivery-manager",
    },
    cost: {
      amount: input.amount,
      currency: input.currency ?? "USD",
      direction: input.direction ?? "charge",
      label: `Estimate · ${input.customerName}`,
    },
  });
}

export async function decideQueueApproval(input: {
  itemId: string;
  decision: "approved" | "rejected";
  decidedBy?: string;
  notes?: string;
}) {
  const intake = createDeskIntake();
  return intake.approveQueueItem(input.itemId, input.decision, {
    decidedBy: input.decidedBy ?? "delivery-manager",
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  });
}

export async function decideCostApproval(input: {
  costEstimateId: string;
  decision: "approved" | "rejected";
  decidedBy?: string;
  notes?: string;
}) {
  const intake = createDeskIntake();
  return intake.approveCost(input.costEstimateId, input.decision, {
    decidedBy: input.decidedBy ?? "finance",
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  });
}

export async function reorderIntake(input: {
  orderedItemIds: string[];
  signedOffBy?: string;
  notes?: string;
}) {
  const intake = createDeskIntake();
  return intake.reorder({
    orderedItemIds: input.orderedItemIds,
    signOff: {
      signedOffBy: input.signedOffBy ?? "delivery-manager",
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });
}

export async function startFromIntakeItem(itemId: string) {
  const intake = createDeskIntake();
  const { report, queue } = await intake.startLeadFromApprovedQueueItem(itemId, {
    requestedBy: "delivery-manager",
  });
  const desk = wrapDeskReport(report);
  await writeDeskReport(desk);
  return { report, queue, desk, runId: report.runId };
}

export { intakePaths };
