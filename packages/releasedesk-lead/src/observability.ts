import { formatMockNote, nowIso } from "@releasedesk/core";

/**
 * Observability hooks — emit structured run metrics for inspect-and-adapt loops.
 * Default sink is an in-memory MOCK recorder (no external APM required).
 */

export type ObservabilityEventKind =
  | "run.started"
  | "checkpoint.evaluated"
  | "remediation.cycle"
  | "test_gate.evaluated"
  | "release_notes.generated"
  | "rollback.plan_created"
  | "human.gate_requested"
  | "run.completed";

export type ObservabilityEvent = {
  id: string;
  kind: ObservabilityEventKind;
  runId: string;
  at: string;
  message: string;
  metrics?: Record<string, number | string | boolean | null>;
  mocked: boolean;
};

export type ObservabilitySink = {
  mode: "mock" | "real";
  emit(event: Omit<ObservabilityEvent, "id" | "at"> & { id?: string; at?: string }): Promise<ObservabilityEvent> | ObservabilityEvent;
  list?(): ObservabilityEvent[];
};

export type ObservabilitySummary = {
  mode: "mock" | "real";
  eventCount: number;
  kinds: Record<string, number>;
  durationMs?: number;
  remediationCycles?: number;
  testGateStatus?: string;
  readiness?: string;
  mocked: boolean;
  recent: ObservabilityEvent[];
};

export type ObservabilityRecord = {
  summary: ObservabilitySummary;
  events: ObservabilityEvent[];
};

let obsSeq = 0;

export function createMockObservabilitySink(): ObservabilitySink & {
  list(): ObservabilityEvent[];
} {
  const events: ObservabilityEvent[] = [];
  return {
    mode: "mock",
    list() {
      return [...events];
    },
    emit(input) {
      obsSeq += 1;
      const event: ObservabilityEvent = {
        id: input.id ?? `obs_${obsSeq}_${Date.now()}`,
        kind: input.kind,
        runId: input.runId,
        at: input.at ?? nowIso(),
        message: input.message.startsWith("MOCK:")
          ? input.message
          : formatMockNote(input.message),
        ...(input.metrics !== undefined ? { metrics: input.metrics } : {}),
        mocked: true,
      };
      events.push(event);
      return event;
    },
  };
}

export function parseObservabilityRecord(raw: unknown): ObservabilityRecord {
  if (!raw || typeof raw !== "object") {
    return {
      summary: {
        mode: "mock",
        eventCount: 0,
        kinds: {},
        mocked: true,
        recent: [],
      },
      events: [],
    };
  }
  const rec = raw as Partial<ObservabilityRecord>;
  return {
    summary: rec.summary ?? {
      mode: "mock",
      eventCount: 0,
      kinds: {},
      mocked: true,
      recent: [],
    },
    events: Array.isArray(rec.events) ? rec.events : [],
  };
}

export function summarizeObservability(
  events: readonly ObservabilityEvent[],
  extras?: {
    mode?: "mock" | "real";
    durationMs?: number;
    remediationCycles?: number;
    testGateStatus?: string;
    readiness?: string;
  },
): ObservabilitySummary {
  const kinds: Record<string, number> = {};
  for (const e of events) {
    kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  }
  return {
    mode: extras?.mode ?? "mock",
    eventCount: events.length,
    kinds,
    ...(extras?.durationMs !== undefined ? { durationMs: extras.durationMs } : {}),
    ...(extras?.remediationCycles !== undefined
      ? { remediationCycles: extras.remediationCycles }
      : {}),
    ...(extras?.testGateStatus !== undefined ? { testGateStatus: extras.testGateStatus } : {}),
    ...(extras?.readiness !== undefined ? { readiness: extras.readiness } : {}),
    mocked: extras?.mode !== "real",
    recent: events.slice(-12),
  };
}
