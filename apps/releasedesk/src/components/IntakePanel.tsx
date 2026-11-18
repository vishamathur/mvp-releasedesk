"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { MockLabel } from "./MockLabel";

type Cost = {
  id: string;
  customerId: string;
  amount: number;
  currency: string;
  direction: string;
  source: string;
  approval: { status: string; decidedBy?: string };
  mock?: { mocked?: boolean };
};

type ViewItem = {
  item: {
    id: string;
    status: string;
    position: number;
    customerId: string;
    queueApproval?: { decision: string; decidedBy?: string };
  };
  customer: { customerId: string; name: string; weight: number };
  request: { id: string; title: string; summary: string };
  cost: Cost;
  leadReady: boolean;
  blockReason?: string;
};

type Props = {
  initialItems: ViewItem[];
  customers: Array<{ customerId: string; name: string; weight: number }>;
};

export function IntakePanel({ initialItems, customers }: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    customerName: "Northwind Bank",
    customerId: "cust_northwind",
    title: "",
    summary: "",
    amount: "5000",
  });

  const items = useMemo(() => {
    if (filter === "all") return initialItems;
    return initialItems.filter((v) => v.item.customerId === filter);
  }, [filter, initialItems]);

  async function refresh() {
    router.refresh();
  }

  async function enqueue(e: React.FormEvent) {
    e.preventDefault();
    setBusy("enqueue");
    setError(null);
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerId: form.customerId || undefined,
          customerName: form.customerName,
          title: form.title,
          summary: form.summary,
          amount: Number(form.amount),
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Enqueue failed");
      setForm((f) => ({ ...f, title: "", summary: "" }));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enqueue failed");
    } finally {
      setBusy(null);
    }
  }

  async function approve(kind: "queue" | "cost", id: string, decision: "approved" | "rejected") {
    setBusy(`${kind}:${id}:${decision}`);
    setError(null);
    try {
      const res = await fetch("/api/intake/approvals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          kind === "queue"
            ? { kind: "queue", itemId: id, decision, decidedBy: "delivery-manager@northwind" }
            : {
                kind: "cost",
                costEstimateId: id,
                decision,
                decidedBy: "finance@northwind",
              },
        ),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Approval failed");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setBusy(null);
    }
  }

  async function startLead(itemId: string) {
    setBusy(`start:${itemId}`);
    setError(null);
    try {
      const res = await fetch("/api/intake/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      const body = (await res.json()) as { runId?: string; error?: string };
      if (!res.ok || !body.runId) throw new Error(body.error ?? "Start failed");
      router.push(`/runs/${body.runId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Start failed");
      setBusy(null);
    }
  }

  async function move(itemId: string, direction: -1 | 1) {
    const ordered = [...initialItems]
      .sort((a, b) => a.item.position - b.item.position)
      .map((v) => v.item.id);
    const idx = ordered.indexOf(itemId);
    const swap = idx + direction;
    if (idx < 0 || swap < 0 || swap >= ordered.length) return;
    const next = [...ordered];
    const tmp = next[idx]!;
    next[idx] = next[swap]!;
    next[swap] = tmp;
    setBusy(`reorder:${itemId}`);
    setError(null);
    try {
      const res = await fetch("/api/intake/reorder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderedItemIds: next,
          signedOffBy: "delivery-manager@northwind",
          notes: "Quick re-prioritize sign-off from desk UI",
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Reorder failed");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reorder failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-8">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-2xl text-rd-ink">Customer intake</h2>
          <MockLabel>MOCK billing estimates</MockLabel>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-rd-forest/70">
          Multi-customer weighted backlog. Each request has a cost estimate keyed by{" "}
          <code className="font-mono text-xs">customerId</code>. Both cost and queue
          approvals are required before Lead; re-prioritize needs a quick sign-off.
        </p>
      </div>

      <form onSubmit={enqueue} className="space-y-3 border-t border-rd-forest/10 pt-6">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-rd-forest/50">
          New request
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-rd-forest/60">
              Customer
            </span>
            <input
              className="w-full rounded-md border border-rd-forest/20 bg-white/80 px-3 py-2 text-sm outline-none focus:border-rd-canopy"
              value={form.customerName}
              onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-rd-forest/60">
              customerId
            </span>
            <input
              className="w-full rounded-md border border-rd-forest/20 bg-white/80 px-3 py-2 font-mono text-sm outline-none focus:border-rd-canopy"
              value={form.customerId}
              onChange={(e) => setForm((f) => ({ ...f, customerId: e.target.value }))}
              required
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-rd-forest/60">
              Title
            </span>
            <input
              className="w-full rounded-md border border-rd-forest/20 bg-white/80 px-3 py-2 text-sm outline-none focus:border-rd-canopy"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-rd-forest/60">
              Summary
            </span>
            <textarea
              className="w-full rounded-md border border-rd-forest/20 bg-white/80 px-3 py-2 text-sm outline-none focus:border-rd-canopy"
              rows={2}
              value={form.summary}
              onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-rd-forest/60">
              Cost estimate (USD)
            </span>
            <input
              type="number"
              min={0}
              step="100"
              className="w-full rounded-md border border-rd-forest/20 bg-white/80 px-3 py-2 text-sm outline-none focus:border-rd-canopy"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              required
            />
          </label>
        </div>
        <button type="submit" className="btn-primary" disabled={busy === "enqueue"}>
          {busy === "enqueue" ? "Enqueueing…" : "Enqueue request"}
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2 border-t border-rd-forest/10 pt-6">
        <span className="text-xs font-bold uppercase tracking-[0.14em] text-rd-forest/50">
          View
        </span>
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
            filter === "all" ? "bg-rd-canopy text-white" : "bg-white/60 text-rd-forest"
          }`}
          onClick={() => setFilter("all")}
        >
          All customers
        </button>
        {customers.map((c) => (
          <button
            key={c.customerId}
            type="button"
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
              filter === c.customerId ? "bg-rd-canopy text-white" : "bg-white/60 text-rd-forest"
            }`}
            onClick={() => setFilter(c.customerId)}
          >
            {c.name}
          </button>
        ))}
      </div>

      {error ? <p className="text-sm text-rd-alert">{error}</p> : null}

      <ul className="space-y-4">
        {items.length === 0 ? (
          <li className="text-sm text-rd-forest/60">No intake items yet.</li>
        ) : (
          items.map((row) => (
            <li
              key={row.item.id}
              className="rounded-md border border-rd-forest/15 bg-white/50 px-4 py-4 backdrop-blur-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-rd-brass">
                    #{row.item.position + 1} · {row.customer.name} · {row.item.customerId}
                  </p>
                  <p className="mt-1 font-medium text-rd-ink">{row.request.title}</p>
                  <p className="mt-1 text-sm text-rd-forest/70">{row.request.summary}</p>
                </div>
                <span
                  className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${
                    row.item.status === "approved_for_dev"
                      ? "status-ready"
                      : row.item.status === "rejected"
                        ? "status-not_ready"
                        : row.item.status === "in_dev" || row.item.status === "done"
                          ? "status-ready"
                          : "status-needs_human"
                  }`}
                >
                  {row.item.status}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                <span className="font-semibold text-rd-ink">
                  {row.cost.currency} {row.cost.amount.toLocaleString()} · {row.cost.direction}
                </span>
                <span className="font-mono text-[11px] text-rd-forest/45">
                  cost {row.cost.id} · cust {row.cost.customerId}
                </span>
                {row.cost.source === "mock" || row.cost.mock?.mocked ? (
                  <MockLabel>MOCK currency</MockLabel>
                ) : null}
                <span className="text-xs uppercase tracking-wider text-rd-forest/55">
                  cost gate: {row.cost.approval.status}
                </span>
                <span className="text-xs uppercase tracking-wider text-rd-forest/55">
                  queue gate: {row.item.queueApproval?.decision ?? "pending"}
                </span>
              </div>

              {row.blockReason ? (
                <p className="mt-2 text-xs text-rd-forest/55">{row.blockReason}</p>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                {row.cost.approval.status === "pending" ? (
                  <>
                    <button
                      type="button"
                      className="btn-primary !px-3 !py-1.5 !text-xs"
                      disabled={Boolean(busy)}
                      onClick={() => approve("cost", row.cost.id, "approved")}
                    >
                      Approve cost
                    </button>
                    <button
                      type="button"
                      className="btn-danger !px-3 !py-1.5 !text-xs"
                      disabled={Boolean(busy)}
                      onClick={() => approve("cost", row.cost.id, "rejected")}
                    >
                      Reject cost
                    </button>
                  </>
                ) : null}
                {!row.item.queueApproval ? (
                  <>
                    <button
                      type="button"
                      className="btn-primary !px-3 !py-1.5 !text-xs"
                      disabled={Boolean(busy)}
                      onClick={() => approve("queue", row.item.id, "approved")}
                    >
                      Approve for development
                    </button>
                    <button
                      type="button"
                      className="btn-danger !px-3 !py-1.5 !text-xs"
                      disabled={Boolean(busy)}
                      onClick={() => approve("queue", row.item.id, "rejected")}
                    >
                      Reject for development
                    </button>
                  </>
                ) : null}
                {row.leadReady ? (
                  <button
                    type="button"
                    className="btn-primary !px-3 !py-1.5 !text-xs"
                    disabled={Boolean(busy)}
                    onClick={() => startLead(row.item.id)}
                  >
                    Start Lead / SDLC
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn-secondary !px-3 !py-1.5 !text-xs"
                  disabled={Boolean(busy)}
                  onClick={() => move(row.item.id, -1)}
                >
                  Move up
                </button>
                <button
                  type="button"
                  className="btn-secondary !px-3 !py-1.5 !text-xs"
                  disabled={Boolean(busy)}
                  onClick={() => move(row.item.id, 1)}
                >
                  Move down
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
