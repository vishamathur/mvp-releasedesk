import { describe, expect, it } from "vitest";
import {
  assertCostTiedToCustomer,
  canStartLeadFromQueueItem,
  createCostEstimate,
  createEmptyBacklog,
  enqueueCustomerRequest,
  markQueueItemInDev,
  recordCostApprovalOnQueue,
  recordQueueApproval,
  reorderBacklog,
  sumCostsByCustomer,
  updateCustomerRequest,
  viewBacklog,
  viewBacklogByCustomer,
} from "./intake.js";

function seedMultiCustomer() {
  let queue = createEmptyBacklog({ name: "Multi-customer backlog" });
  const a1 = enqueueCustomerRequest(queue, {
    customer: { customerId: "cust_northwind", name: "Northwind Bank", weight: 1 },
    request: {
      title: "KYC PEP scoring tweak",
      summary: "Adjust PEP weights",
      requestedBy: "cs-northwind",
    },
    cost: {
      amount: 12000,
      currency: "USD",
      direction: "charge",
      label: "NW delivery",
      source: "billing_system",
    },
    applyFairness: false,
  });
  queue = a1.queue;
  const a2 = enqueueCustomerRequest(queue, {
    customerId: "cust_northwind",
    request: {
      title: "Document upload retry",
      summary: "Retry failed uploads",
      requestedBy: "cs-northwind",
    },
    cost: { amount: 4500, direction: "spend", label: "NW internal", source: "billing_system" },
    applyFairness: false,
  });
  queue = a2.queue;
  const b1 = enqueueCustomerRequest(queue, {
    customer: { customerId: "cust_contoso", name: "Contoso Retail", weight: 1 },
    request: {
      title: "Retail KYC onboarding",
      summary: "Contoso onboarding flow",
      requestedBy: "cs-contoso",
    },
    cost: { amount: 8000, direction: "charge", label: "Contoso delivery", source: "billing_system" },
    applyFairness: true,
  });
  return { queue: b1.queue, a1, a2, b1 };
}

describe("multi-customer intake with customerId-keyed costs", () => {
  it("enqueues multiple customers; each estimate carries customerId", () => {
    const { queue, a1, b1 } = seedMultiCustomer();
    expect(queue.customers.map((c) => c.customerId).sort()).toEqual([
      "cust_contoso",
      "cust_northwind",
    ]);
    expect(a1.cost.customerId).toBe("cust_northwind");
    expect(b1.cost.customerId).toBe("cust_contoso");
    expect(a1.item.customerId).toBe("cust_northwind");
    expect(a1.request.customerId).toBe("cust_northwind");

    for (const cost of queue.costEstimates) {
      expect(cost.customerId).toMatch(/^cust_/);
      assertCostTiedToCustomer(cost, cost.customerId);
    }
  });

  it("cannot orphan cost from customerId", () => {
    expect(() =>
      createCostEstimate({
        requestId: "creq_1_1",
        customerId: "",
        amount: 10,
        direction: "charge",
        source: "billing_system",
      }),
    ).toThrow(/customerId|orphaned/i);

    expect(() =>
      createCostEstimate({
        requestId: "creq_1_1",
        customerId: "cust_northwind",
        amount: 10,
        direction: "charge",
      } as never),
    ).toThrow(/billing_system/);

    const { a1 } = seedMultiCustomer();
    expect(() => assertCostTiedToCustomer(a1.cost, "cust_other")).toThrow(/does not match/);

    // update must preserve customerId
    const { queue, a1: first } = seedMultiCustomer();
    const updated = updateCustomerRequest(queue, {
      requestId: first.request.id,
      patch: { summary: "scope change" },
      costPatch: { amount: 13000 },
    });
    expect(updated.cost?.customerId).toBe("cust_northwind");
    expect(updated.cost?.amount).toBe(13000);
  });

  it("exposes per-customer views and cost tracking", () => {
    const { queue } = seedMultiCustomer();
    const byCustomer = viewBacklogByCustomer(queue);
    expect(byCustomer.cust_northwind?.length).toBe(2);
    expect(byCustomer.cust_contoso?.length).toBe(1);
    expect(byCustomer.cust_northwind?.every((v) => v.cost.customerId === "cust_northwind")).toBe(
      true,
    );

    const totals = sumCostsByCustomer(queue);
    expect(totals.cust_northwind?.totalAmount).toBe(16500);
    expect(totals.cust_contoso?.totalAmount).toBe(8000);

    const view = viewBacklog(queue);
    expect(view.every((v) => v.cost.approval.status === "pending")).toBe(true);
    expect(view.every((v) => !v.leadReady)).toBe(true);
  });

  it("weighting fairness smoke: does not let one customer monopolize top slots", () => {
    let queue = createEmptyBacklog();
    for (let i = 0; i < 4; i += 1) {
      queue = enqueueCustomerRequest(queue, {
        customer:
          i === 0
            ? { customerId: "cust_heavy", name: "Heavy Co", weight: 1 }
            : undefined,
        customerId: "cust_heavy",
        request: {
          title: `Heavy ${i}`,
          summary: `Heavy request ${i}`,
          requestedBy: "cs",
        },
        cost: { amount: 1000 + i, direction: "charge", source: "billing_system" },
        applyFairness: false,
      }).queue;
    }
    queue = enqueueCustomerRequest(queue, {
      customer: { customerId: "cust_light", name: "Light Co", weight: 1 },
      request: {
        title: "Light 0",
        summary: "Light request",
        requestedBy: "cs",
      },
      cost: { amount: 500, direction: "charge", source: "billing_system" },
      applyFairness: true,
    }).queue;

    const order = queue.items
      .filter((i) => i.status !== "done")
      .sort((a, b) => a.position - b.position)
      .map((i) => i.customerId);

    // With maxConsecutive=1, customers should interleave — light appears before all 4 heavy.
    expect(order).toContain("cust_light");
    expect(order.indexOf("cust_light")).toBeLessThan(4);
    // No run of 4 consecutive heavy at the front after fairness
    expect(order.slice(0, 2).includes("cust_light") || order[1] === "cust_light" || order[0] !== order[1]).toBe(
      true,
    );
    const firstTwoDistinct = new Set(order.slice(0, 2));
    expect(firstTwoDistinct.size).toBe(2);
  });

  it("cost-only or queue-only approval still blocks Lead; both clear allows start", () => {
    let { queue, a1 } = seedMultiCustomer();
    const itemId = a1.item.id;
    const costId = a1.cost.id;

    // neither
    expect(canStartLeadFromQueueItem(a1.item, a1.cost).ok).toBe(false);

    // cost-only
    const costOnly = recordCostApprovalOnQueue(queue, costId, "approved", {
      decidedBy: "finance@northwind",
    });
    queue = costOnly.queue;
    let item = queue.items.find((i) => i.id === itemId)!;
    expect(canStartLeadFromQueueItem(item, costOnly.cost).ok).toBe(false);

    // reset via fresh seed for queue-only path
    ({ queue, a1 } = seedMultiCustomer());
    const qOnly = recordQueueApproval(queue, a1.item.id, "approved", {
      decidedBy: "delivery-manager",
    });
    queue = qOnly.queue;
    expect(qOnly.item.status).toBe("queued");
    const cost = queue.costEstimates.find((c) => c.id === a1.cost.id)!;
    expect(canStartLeadFromQueueItem(qOnly.item, cost).ok).toBe(false);

    const both = recordCostApprovalOnQueue(queue, a1.cost.id, "approved", {
      decidedBy: "finance@northwind",
    });
    queue = both.queue;
    item = queue.items.find((i) => i.id === a1.item.id)!;
    expect(item.status).toBe("approved_for_dev");
    expect(both.cost.customerId).toBe("cust_northwind");
    expect(canStartLeadFromQueueItem(item, both.cost).ok).toBe(true);

    const started = markQueueItemInDev(queue, item.id, "run_test");
    expect(started.item.status).toBe("in_dev");
  });

  it("rejected stays blocked; reorder requires sign-off", () => {
    let { queue, a1 } = seedMultiCustomer();
    queue = recordCostApprovalOnQueue(queue, a1.cost.id, "approved", {
      decidedBy: "finance",
    }).queue;
    const rejected = recordQueueApproval(queue, a1.item.id, "rejected", {
      decidedBy: "dm",
    });
    expect(rejected.item.status).toBe("rejected");
    expect(() =>
      markQueueItemInDev(rejected.queue, rejected.item.id, "run_x"),
    ).toThrow(/rejected/);

    const { queue: q2 } = seedMultiCustomer();
    const ids = q2.items
      .filter((i) => i.status !== "done")
      .sort((a, b) => a.position - b.position)
      .map((i) => i.id);
    expect(() => reorderBacklog(q2, { orderedItemIds: [...ids].reverse() })).toThrow(
      /re-prioritize sign-off/,
    );
    const ok = reorderBacklog(q2, {
      orderedItemIds: [...ids].reverse(),
      signOff: { signedOffBy: "dm", notes: "fairness tweak" },
    });
    expect(ok.signOff.signedOffBy).toBe("dm");
  });
});
