"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildTrace, parseJsonl, type HandoffTrace, type LogLine, type ProcessDefinition } from "@releasedesk/core/handoff-log";

const COPY = "Bots run the process; Release Desk Log records it; Desk shows it.";

const LANES = [
  { id: "lead", name: "Lead" },
  { id: "change-analyst", name: "Change Analyst" },
  { id: "standards", name: "Standards" },
  { id: "security", name: "Security" },
  { id: "builder", name: "Builder" },
  { id: "log", name: "Release Desk Log" },
] as const;

type RequestSummary = {
  requestId: string;
  pid: string | null;
  pidVersion: string | null;
  currentStage: string | null;
  summary: string;
  anomalyCount: number;
};

type ListBody = {
  copy: string;
  source: "log" | "unset";
  logDirEnv: string;
  requests: RequestSummary[];
  malformed: Array<{ file: string; line: number; error: string }>;
  processes: ProcessDefinition[];
};

type TraceBody =
  | { ok: true; source: string; trace: HandoffTrace; copy: string }
  | { ok: false; source: string; error: string };

function laneFor(line: { from: string; event: string }): string {
  if (line.event === "transition" || line.event === "anomaly" || line.event === "note") return "log";
  if (LANES.some((lane) => lane.id === line.from)) return line.from;
  return "log";
}

export function HandoffBoard() {
  const [list, setList] = useState<ListBody | null>(null);
  const [trace, setTrace] = useState<HandoffTrace | null>(null);
  const [importedLabel, setImportedLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    const res = await fetch("/api/handoff");
    const body = (await res.json()) as ListBody;
    setList(body);
    return body;
  }, []);

  useEffect(() => {
    void loadList().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Could not load the log");
    });
  }, [loadList]);

  async function openRequest(requestId: string) {
    setBusy(true);
    setError(null);
    setImportedLabel(null);
    try {
      const res = await fetch(`/api/handoff/${requestId}`);
      const body = (await res.json()) as TraceBody;
      if (!body.ok) throw new Error(body.error);
      setTrace(body.trace);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the trace");
    } finally {
      setBusy(false);
    }
  }

  async function importFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const processes = list?.processes ?? (await loadList()).processes;
      const lines: LogLine[] = [];
      const problems: string[] = [];
      for (const file of Array.from(files)) {
        const text = await file.text();
        const parsed = parseJsonl(text, file.name);
        lines.push(...parsed.lines);
        for (const bad of parsed.malformed) problems.push(`${bad.file}:${bad.line} ${bad.error}`);
      }
      if (lines.length === 0) throw new Error(problems[0] ?? "No log lines in the selected files");
      const requestId = lines[0]?.requestId ?? "import";
      const same = lines.filter((line) => line.requestId === requestId);
      setTrace(buildTrace(same, processes));
      setImportedLabel(Array.from(files).map((file) => file.name).join(", "));
      if (problems.length > 0) setError(problems.join(" · "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the file");
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(() => {
    const buckets = new Map<string, HandoffTrace["timeline"]>();
    for (const lane of LANES) buckets.set(lane.id, []);
    for (const line of trace?.timeline ?? []) {
      const lane = laneFor(line);
      buckets.get(lane)?.push(line);
    }
    return buckets;
  }, [trace]);

  const sourceLabel =
    importedLabel != null
      ? `Imported ${importedLabel}`
      : list?.source === "log"
          ? "Release Desk Log directory"
          : `No log directory. Set ${list?.logDirEnv ?? "RELEASEDESK_LOG_DIR"}.`;

  return (
    <section className="space-y-6">
      <p className="max-w-3xl text-rd-forest/80">{list?.copy ?? COPY}</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn-secondary cursor-pointer">
          Import .jsonl
          <input
            className="sr-only"
            type="file"
            accept=".jsonl,application/x-ndjson,application/json"
            multiple
            onChange={(event) => {
              void importFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        <span className="text-sm text-rd-forest/70">{sourceLabel}</span>
      </div>

      {list?.source === "unset" && importedLabel == null ? (
        <p className="rounded-2xl border border-dashed border-rd-fog bg-white px-4 py-6 text-sm text-rd-forest/80">
          Desk is empty until <code className="font-mono">{list.logDirEnv}</code> points at the
          Release Desk Log directory, or you import a <code className="font-mono">.jsonl</code> file.
          Import stays in the browser. Desk does not upload it and does not write a log.
        </p>
      ) : null}

      {error ? <p className="text-sm text-rd-canopy">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        {(list?.requests ?? []).map((request) => (
          <button
            key={request.requestId}
            type="button"
            className="rounded-full border border-rd-fog bg-white px-3 py-1 text-sm"
            onClick={() => void openRequest(request.requestId)}
            disabled={busy}
          >
            {request.requestId}
            {request.pid ? ` · ${request.pid}` : ""}
            {request.currentStage ? ` · ${request.currentStage}` : ""}
            {request.anomalyCount > 0 ? ` · ${request.anomalyCount} anomalies` : ""}
          </button>
        ))}
      </div>

      {trace ? (
        <div className="space-y-6">
          <div>
            <h2 className="font-display text-2xl text-rd-ink">
              {trace.requestId} · {trace.pid} {trace.pidVersion}
            </h2>
            <p className="text-sm text-rd-forest/70">Current stage: {trace.currentStage ?? "none yet"}</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-6">
            {LANES.map((lane) => (
              <div key={lane.id} className="rounded-2xl border border-rd-fog bg-white p-3">
                <h3 className="text-sm font-bold text-rd-ink">{lane.name}</h3>
                <ol className="mt-3 space-y-2">
                  {(grouped.get(lane.id) ?? []).map((line) => (
                    <li key={`${line.seq}-${line.event}`} className="rounded-xl bg-rd-mist px-2 py-2 text-xs">
                      <div className="font-mono text-rd-forest/60">
                        {line.seq} · {line.event}
                        {line.stage ? ` · ${line.stage}` : ""}
                      </div>
                      <p className="mt-1 text-rd-ink">{line.summary}</p>
                      {line.messageValidation && !line.messageValidation.ok ? (
                        <p className="mt-1 text-rd-canopy">
                          {line.messageValidation.code}: {line.messageValidation.errors.join(" ")}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
          <div>
            <h3 className="font-display text-xl text-rd-ink">Gate decisions</h3>
            {trace.gateDecisions.length === 0 ? (
              <p className="mt-2 text-sm text-rd-forest/70">No gate decision in this trace.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {trace.gateDecisions.map((decision) => (
                  <li key={`${decision.gate}-${decision.at}`} className="rounded-xl border border-rd-fog bg-white px-3 py-2 text-sm">
                    <span className="font-bold">{decision.gate}</span> · {decision.decidedBy ?? "unnamed"} ·{" "}
                    {decision.gateOwner ?? "unknown owner"} · {decision.at}
                    {decision.verbatim ? <span className="block text-rd-forest/80">{decision.verbatim}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="font-display text-xl text-rd-ink">Anomalies</h3>
            {trace.anomalies.length === 0 ? (
              <p className="mt-2 text-sm text-rd-forest/70">None flagged.</p>
            ) : (
              <ul className="mt-2 list-disc pl-5 text-sm text-rd-canopy">
                {trace.anomalies.map((anomaly) => (
                  <li key={anomaly}>{anomaly}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
