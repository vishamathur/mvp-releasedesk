import { z } from "zod";
import type { ProcessDefinition } from "./process-defs.js";

export type { ProcessDefinition } from "./process-defs.js";
import { validateHandoffMessage, type HandoffCode } from "./schema.js";

export const LOG_EVENTS = [
  "sent",
  "received",
  "reject",
  "gate-ask",
  "gate-decision",
  "transition",
  "note",
  "anomaly",
] as const;

export type LogEvent = (typeof LOG_EVENTS)[number];

/** ISO-8601 timestamp with a numeric offset or Z. */
export const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export const LogLineSchema = z
  .object({
    requestId: z.string().regex(/^REQ-[A-Za-z0-9-]+$/),
    seq: z.number().int(),
    at: z.string().regex(ISO_WITH_OFFSET, "ISO-8601 with offset"),
    event: z.enum(LOG_EVENTS),
    pid: z.enum(["PID-ER", "PID-NC"]),
    pidVersion: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    kind: z.string().min(1).optional(),
    stage: z.string().min(1).optional(),
    action: z.string().min(1).optional(),
    summary: z.string().min(1),
    gate: z.string().min(1).optional(),
    gateOwner: z.string().min(1).optional(),
    decidedBy: z.string().min(1).nullable().optional(),
    verbatim: z.string().optional(),
    rejectCode: z.string().min(1).optional(),
    confirmations: z.array(z.string()).optional(),
    anomalies: z.array(z.string()).optional(),
    message: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type LogLine = z.infer<typeof LogLineSchema>;

export type MalformedLogLine = {
  file: string;
  line: number;
  text: string;
  error: string;
};

export type MessageValidation =
  | { ok: true }
  | { ok: false; code: HandoffCode; errors: string[] };

export type TraceLine = LogLine & { messageValidation?: MessageValidation };

export type GateDecisionView = {
  gate: string;
  decidedBy: string | null;
  at: string;
  verbatim: string | null;
  gateOwner: string | null;
};

export type HandoffTrace = {
  requestId: string;
  pid: LogLine["pid"] | null;
  pidVersion: string | null;
  timeline: TraceLine[];
  currentStage: string | null;
  gateDecisions: GateDecisionView[];
  anomalies: string[];
};

export function parseJsonl(
  text: string,
  file = "import.jsonl",
): { lines: LogLine[]; malformed: MalformedLogLine[] } {
  const lines: LogLine[] = [];
  const malformed: MalformedLogLine[] = [];
  const rawLines = text.split(/\r?\n/);
  rawLines.forEach((raw, index) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch (err) {
      malformed.push({
        file,
        line: index + 1,
        text: trimmed.slice(0, 240),
        error: err instanceof Error ? err.message : "Invalid JSON",
      });
      return;
    }
    const result = LogLineSchema.safeParse(parsed);
    if (!result.success) {
      malformed.push({
        file,
        line: index + 1,
        text: trimmed.slice(0, 240),
        error: result.error.issues.map((issue) => `${issue.path.join(".") || "line"}: ${issue.message}`).join("; "),
      });
      return;
    }
    lines.push(result.data);
  });
  return { lines, malformed };
}

export function buildTrace(lines: readonly LogLine[], processes: readonly ProcessDefinition[]): HandoffTrace {
  const sorted = [...lines].sort((a, b) => a.seq - b.seq || a.at.localeCompare(b.at));
  const anomalies: string[] = [];
  const timeline: TraceLine[] = sorted.map((line) => {
    for (const anomaly of line.anomalies ?? []) {
      anomalies.push(`seq ${line.seq}: ${anomaly}`);
    }
    if (!line.message) return { ...line };
    const validated = validateHandoffMessage(line.message, processes);
    if (!validated.ok) {
      anomalies.push(`seq ${line.seq}: ${validated.code}`);
      return {
        ...line,
        messageValidation: { ok: false, code: validated.code, errors: validated.errors },
      };
    }
    return { ...line, messageValidation: { ok: true } };
  });
  const transitions = sorted.filter((line) => line.event === "transition");
  const lastTransition = transitions[transitions.length - 1];
  const gateDecisions: GateDecisionView[] = sorted
    .filter((line) => line.event === "gate-decision")
    .map((line) => ({
      gate: line.gate ?? line.stage ?? "",
      decidedBy: line.decidedBy ?? null,
      at: line.at,
      verbatim: line.verbatim ?? null,
      gateOwner: line.gateOwner ?? null,
    }));
  const first = sorted[0];
  return {
    requestId: first?.requestId ?? "",
    pid: first?.pid ?? null,
    pidVersion: first?.pidVersion ?? null,
    timeline,
    currentStage: lastTransition?.stage ?? null,
    gateDecisions,
    anomalies,
  };
}
