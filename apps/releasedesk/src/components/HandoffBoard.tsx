"use client";

import { useCallback, useEffect, useState } from "react";
import { MockLabel } from "@/components/MockLabel";

type Stage = {
  id: string;
  name: string;
  owner: string;
  consulting: string[];
  humanApprover: string | null;
  current: boolean;
  reached: boolean;
};

type Gate = {
  gate: string;
  status: "pending";
  decidedBy: null;
  note: string;
  approver: string;
};

type RequestSummary = {
  requestId: string;
  pid: string;
  status: string;
  currentStage: string;
  customerLabel: string;
  summary: string;
  pendingGate: Gate | null;
};

type TraceEvent = {
  seq: number;
  at: string;
  type: string;
  text: string;
};

type RequestView = {
  state: {
    requestId: string;
    pid: string;
    version: string;
    currentStage: string;
    status: string;
    thread: { channel: string; threadId: string };
    customerLabel: string;
    summary: string;
  };
  stages: Stage[];
  pendingGate: Gate | null;
  decisions: Array<{ gate: string; decision: string; decidedBy: string; note: string }>;
  subAgents: Array<{ agent: string; summary: string; cloudClient: string }>;
  lastBuild: { prUrl: string; testsPassed: boolean; testsSummary: string; proposedBranch: string } | null;
  kickoff: { sprint: string; note: string } | null;
  trace: TraceEvent[];
  cloudClient: "mock";
  messages: Array<{ message: { from: string; to: string; kind: string; stage: string; summary: string } }>;
};

type Catalog = {
  cloudClient: "mock";
  roster: Array<{ id: string; name: string; kind: string; does: string }>;
  processes: Array<{ id: string; title: string; channel: string; stages: Stage[] }>;
  requests: RequestSummary[];
};

type Failure = { ok: false; code: string; errors: string[] };
type Success = { ok: true; request: RequestView };

const DEFAULTS = {
  "PID-ER": {
    customerLabel: "NORTHWIND-014",
    summary: "KYC address refresh for an existing customer.",
  },
  "PID-NC": {
    customerLabel: "Harbor & Co",
    summary: "New customer asking for a KYC product Northwind does not yet run.",
  },
} as const;

export function HandoffBoard() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [current, setCurrent] = useState<RequestView | null>(null);
  const [pid, setPid] = useState<"PID-ER" | "PID-NC">("PID-ER");
  const [customerLabel, setCustomerLabel] = useState<string>(DEFAULTS["PID-ER"].customerLabel);
  const [summary, setSummary] = useState<string>(DEFAULTS["PID-ER"].summary);
  const [decidedBy, setDecidedBy] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ruleResult, setRuleResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadCatalog = useCallback(async () => {
    const res = await fetch("/api/handoff");
    const body = (await res.json()) as Catalog;
    setCatalog(body);
  }, []);

  useEffect(() => {
    void loadCatalog().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Could not load handover");
    });
  }, [loadCatalog]);

  function choosePid(next: "PID-ER" | "PID-NC") {
    setPid(next);
    setCustomerLabel(DEFAULTS[next].customerLabel);
    setSummary(DEFAULTS[next].summary);
  }

  async function openRequest() {
    setBusy(true);
    setError(null);
    setRuleResult(null);
    try {
      const res = await fetch("/api/handoff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pid, customerLabel, summary }),
      });
      const body = (await res.json()) as Success | Failure;
      if (!body.ok) throw new Error(`${body.code}: ${body.errors.join(" ")}`);
      setCurrent(body.request);
      setDecidedBy("");
      setNote(body.request.pendingGate?.note ?? "");
      await loadCatalog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Open failed");
    } finally {
      setBusy(false);
    }
  }

  async function openExisting(requestId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/handoff/${requestId}`);
      const body = (await res.json()) as Success | Failure;
      if (!body.ok) throw new Error(`${body.code}: ${body.errors.join(" ")}`);
      setCurrent(body.request);
      setNote(body.request.pendingGate?.note ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "approved" | "rejected") {
    if (!current?.pendingGate) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/handoff/${current.state.requestId}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gate: current.pendingGate.gate,
          decision,
          decidedBy,
          note,
        }),
      });
      const body = (await res.json()) as Success | Failure;
      if (!body.ok) throw new Error(`${body.code}: ${body.errors.join(" ")}`);
      setCurrent(body.request);
      setNote(body.request.pendingGate?.note ?? "");
      await loadCatalog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  }

  async function checkRule(message: Record<string, unknown>) {
    if (!current) return;
    setRuleResult(null);
    const res = await fetch(`/api/handoff/${current.state.requestId}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const body = (await res.json()) as Failure | Success;
    if (!body.ok) setRuleResult(`${body.code}: ${body.errors.join(" ")}`);
    else setRuleResult("accepted");
    const fresh = await fetch(`/api/handoff/${current.state.requestId}`);
    const view = (await fresh.json()) as Success;
    if (view.ok) setCurrent(view.request);
  }

  const envelope = current
    ? {
        v: 1,
        kind: "consult",
        pid: current.state.pid,
        pidVersion: current.state.version,
        requestId: current.state.requestId,
        thread: current.state.thread,
        from: "lead",
        to: "standards",
        stage: current.state.currentStage,
        action: "consult",
        summary: "MOCK: rule check",
        artifactRefs: [`memory:pid.artifacts.${current.state.requestId}`],
        memoryKey: `pid.state.${current.state.requestId}`,
        humanGate: null,
      }
    : null;

  return (
    <div className="space-y-12">
      <section>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-2xl text-rd-ink">Start a request</h2>
          <MockLabel>MOCK bots · cloud client mock</MockLabel>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-rd-forest/75">
          Lead opens one thread and hands each stage to its owner. Human gates stay pending until a
          person replies. Builder launches Coding, then Testing and Review, without a live Cursor call.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {(["PID-ER", "PID-NC"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={item === pid ? "btn-primary" : "btn-secondary"}
              onClick={() => choosePid(item)}
            >
              {item === "PID-ER" ? "PID-ER existing customer" : "PID-NC new customer"}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-rd-ink">Customer</span>
            <input
              className="mt-1 w-full rounded-md border border-rd-mist bg-white/80 px-3 py-2"
              value={customerLabel}
              onChange={(event) => setCustomerLabel(event.target.value)}
            />
          </label>
          <label className="block text-sm md:col-span-2">
            <span className="font-medium text-rd-ink">Ask</span>
            <textarea
              className="mt-1 w-full rounded-md border border-rd-mist bg-white/80 px-3 py-2"
              rows={3}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </label>
        </div>
        <button type="button" className="btn-primary mt-4" disabled={busy} onClick={() => void openRequest()}>
          {busy ? "Running…" : "Open and run to the next human gate"}
        </button>
      </section>

      {catalog ? (
        <section>
          <h2 className="font-display text-2xl text-rd-ink">Roster</h2>
          <ul className="mt-4 grid gap-4 md:grid-cols-2">
            {catalog.roster.map((bot) => (
              <li key={bot.id} className="rounded-md border border-rd-mist/80 bg-white/50 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-rd-forest/50">
                  {bot.kind} · {bot.id}
                </p>
                <h3 className="mt-1 font-display text-xl text-rd-ink">{bot.name}</h3>
                <p className="mt-2 text-sm text-rd-forest/75">{bot.does}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {catalog && catalog.requests.length > 0 ? (
        <section>
          <h2 className="font-display text-2xl text-rd-ink">Requests</h2>
          <ul className="mt-4 divide-y divide-rd-mist/80">
            {catalog.requests.map((item) => (
              <li key={item.requestId} className="flex flex-wrap items-baseline justify-between gap-3 py-3">
                <button type="button" className="text-left" onClick={() => void openExisting(item.requestId)}>
                  <span className="font-medium text-rd-ink">
                    {item.requestId} · {item.pid}
                  </span>
                  <span className="mt-1 block text-sm text-rd-forest/70">
                    {item.customerLabel} · {item.currentStage} · {item.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {error ? (
        <p className="text-sm text-[color:var(--rd-alert)]" role="alert">
          {error}
        </p>
      ) : null}

      {current ? (
        <section className="space-y-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-rd-forest/50">
              {current.state.pid} {current.state.version} · {current.state.thread.channel} ·{" "}
              {current.state.thread.threadId}
            </p>
            <h2 className="mt-2 font-display text-3xl text-rd-ink">{current.state.requestId}</h2>
            <p className="mt-2 text-rd-forest/75">
              {current.state.customerLabel}. {current.state.summary}
            </p>
            <p className="mt-2 text-sm font-medium text-rd-ink">
              Stage {current.state.currentStage} · {current.state.status} · {current.cloudClient}
            </p>
            {current.kickoff ? (
              <p className="mt-2 text-sm text-rd-forest/75">
                Kickoff names {current.kickoff.sprint}. {current.kickoff.note}
              </p>
            ) : null}
          </div>

          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {current.stages.map((stage) => (
              <li
                key={stage.id}
                className={`rounded-md border px-3 py-3 ${
                  stage.current ? "border-[color:var(--rd-brass)] bg-white" : "border-rd-mist/80 bg-white/40"
                }`}
              >
                <p className="text-xs uppercase tracking-[0.14em] text-rd-forest/50">
                  {stage.reached ? "reached" : "waiting"}
                  {stage.current ? " · current" : ""}
                </p>
                <h3 className="mt-1 font-medium text-rd-ink">{stage.name}</h3>
                <p className="text-sm text-rd-forest/70">Owner {stage.owner}</p>
                {stage.humanApprover ? (
                  <p className="text-sm text-rd-forest/70">Human: {stage.humanApprover}</p>
                ) : null}
              </li>
            ))}
          </ol>

          {current.pendingGate ? (
            <form
              className="rounded-md border border-[color:var(--rd-brass)] bg-white/70 p-4"
              onSubmit={(event) => {
                event.preventDefault();
                void decide("approved");
              }}
            >
              <h3 className="font-display text-xl text-rd-ink">
                {current.pendingGate.gate} · {current.pendingGate.approver}
              </h3>
              <p className="mt-2 text-sm text-rd-forest/75">{current.pendingGate.note}</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-medium">Your name</span>
                  <input
                    className="mt-1 w-full rounded-md border border-rd-mist bg-white px-3 py-2"
                    value={decidedBy}
                    onChange={(event) => setDecidedBy(event.target.value)}
                    placeholder="A person, not a bot id"
                    required
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">Note</span>
                  <input
                    className="mt-1 w-full rounded-md border border-rd-mist bg-white px-3 py-2"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || !decidedBy.trim()}
                  onClick={() => void decide("approved")}
                >
                  Approve and continue
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={busy || !decidedBy.trim()}
                  onClick={() => void decide("rejected")}
                >
                  Reject
                </button>
              </div>
            </form>
          ) : null}

          {current.lastBuild ? (
            <p className="text-sm text-rd-forest/75">
              Build {current.lastBuild.proposedBranch} · tests {current.lastBuild.testsPassed ? "passed" : "failed"}.{" "}
              {current.lastBuild.testsSummary}
            </p>
          ) : null}

          {current.subAgents.length > 0 ? (
            <div>
              <h3 className="font-display text-xl text-rd-ink">Mock sub-agents</h3>
              <ul className="mt-3 space-y-2">
                {current.subAgents.map((item, index) => (
                  <li key={`${item.agent}-${index}`} className="text-sm text-rd-forest/80">
                    <span className="font-medium text-rd-ink">{item.agent}</span> · {item.cloudClient} · {item.summary}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <h3 className="font-display text-xl text-rd-ink">Handover trace</h3>
            <ol className="mt-3 space-y-2">
              {current.trace
                .filter((item) => item.type !== "post")
                .map((item) => (
                  <li key={`${item.type}-${item.seq}`} className="text-sm text-rd-forest/80">
                    <span className="font-medium uppercase tracking-wide text-rd-forest/50">{item.type}</span>{" "}
                    {item.text}
                  </li>
                ))}
            </ol>
          </div>

          {current.decisions.length > 0 ? (
            <ul className="text-sm text-rd-forest/80">
              {current.decisions.map((item) => (
                <li key={`${item.gate}-${item.decidedBy}`}>
                  {item.decidedBy} {item.decision} {item.gate}. {item.note}
                </li>
              ))}
            </ul>
          ) : null}

          {envelope ? (
            <div>
              <h3 className="font-display text-xl text-rd-ink">Rule checks</h3>
              <p className="mt-2 text-sm text-rd-forest/70">
                These messages are refused. The stage pointer does not move.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void checkRule({ v: 2, kind: "nope" })}
                >
                  Invalid schema
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    void checkRule({
                      ...envelope,
                      from: "security",
                      to: "lead",
                      pidState: { currentStage: "release-gate" },
                    })
                  }
                >
                  Non-Lead writes state
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    void checkRule({
                      ...envelope,
                      kind: "stage-return",
                      action: "return",
                      from: "security",
                      to: "lead",
                      stage: "security-compliance-approval",
                      humanGate: {
                        gate: "security-compliance-approval",
                        status: "approved",
                        decidedBy: "security",
                        note: "bot signed",
                      },
                    })
                  }
                >
                  Bot sets approved
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void checkRule({ ...envelope, from: "finance-partner" })}
                >
                  Unknown sender
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void checkRule({ ...envelope, to: "coding" })}
                >
                  Unknown recipient
                </button>
              </div>
              {ruleResult ? <p className="mt-3 text-sm text-rd-ink">{ruleResult}</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
