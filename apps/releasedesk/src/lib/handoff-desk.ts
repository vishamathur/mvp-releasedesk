import path from "node:path";
import {
  FileHandoffStore,
  HandoffEngine,
  buildTrace,
  loadProcessDefinitionsSync,
  readLogDir,
  type HandoffTrace,
  type LogLine,
  type MalformedLogLine,
  type ProcessDefinition,
} from "@releasedesk/core";

export const HANDOFF_COPY = "Bots run the process; Release Desk Log records it; Desk shows it.";
export const LOG_DIR_ENV = "RELEASEDESK_LOG_DIR";

function workspaceRoot(): string {
  if (process.cwd().endsWith(`${path.sep}releasedesk`) || process.cwd().endsWith("/releasedesk")) {
    return path.join(process.cwd(), "..", "..");
  }
  return process.cwd();
}

export function handoffStorePath(root = workspaceRoot()): string {
  return path.join(root, "apps", "releasedesk", "data", "handoff.json");
}

export function fixtureLogDir(root = workspaceRoot()): string {
  return path.join(root, "apps", "releasedesk", "test", "fixtures", "releasedesk-log");
}

/** Engine helper for the mock simulation tests. The Desk UI does not call it. */
export function createHandoffEngine(storePath = handoffStorePath()): HandoffEngine {
  return new HandoffEngine({
    workspaceRoot: workspaceRoot(),
    store: new FileHandoffStore(storePath),
  });
}

export type LogSource = "log" | "replay" | "unset";

export function resolveLogDir(options?: {
  replay?: boolean;
  env?: Record<string, string | undefined>;
}): { source: LogSource; dir: string | null } {
  if (options?.replay) return { source: "replay", dir: fixtureLogDir() };
  const configured = (options?.env ?? process.env)[LOG_DIR_ENV]?.trim();
  if (!configured) return { source: "unset", dir: null };
  return { source: "log", dir: configured };
}

export type HandoffRequestSummary = {
  requestId: string;
  pid: LogLine["pid"] | null;
  pidVersion: string | null;
  currentStage: string | null;
  summary: string;
  anomalyCount: number;
};

export type HandoffList = {
  copy: typeof HANDOFF_COPY;
  source: LogSource;
  logDirEnv: typeof LOG_DIR_ENV;
  requests: HandoffRequestSummary[];
  malformed: MalformedLogLine[];
  processes: ProcessDefinition[];
};

function processes(): ProcessDefinition[] {
  return loadProcessDefinitionsSync(workspaceRoot());
}

export function listHandoffLogs(options?: {
  replay?: boolean;
  env?: Record<string, string | undefined>;
}): HandoffList {
  const resolved = resolveLogDir(options);
  const defs = processes();
  if (!resolved.dir) {
    return {
      copy: HANDOFF_COPY,
      source: "unset",
      logDirEnv: LOG_DIR_ENV,
      requests: [],
      malformed: [],
      processes: defs,
    };
  }
  const read = readLogDir(resolved.dir);
  const requests = Object.entries(read.requests)
    .map(([requestId, lines]) => {
      const trace = buildTrace(lines, defs);
      const summary = [...lines].reverse().find((line) => line.summary)?.summary ?? "";
      return {
        requestId,
        pid: trace.pid,
        pidVersion: trace.pidVersion,
        currentStage: trace.currentStage,
        summary,
        anomalyCount: trace.anomalies.length,
      };
    })
    .sort((a, b) => a.requestId.localeCompare(b.requestId));
  return {
    copy: HANDOFF_COPY,
    source: resolved.source,
    logDirEnv: LOG_DIR_ENV,
    requests,
    malformed: read.malformed,
    processes: defs,
  };
}

export function traceHandoffLog(
  requestId: string,
  options?: { replay?: boolean; env?: Record<string, string | undefined> },
): { ok: true; source: LogSource; trace: HandoffTrace; copy: typeof HANDOFF_COPY } | { ok: false; source: LogSource; error: string } {
  const resolved = resolveLogDir(options);
  if (!resolved.dir) {
    return {
      ok: false,
      source: "unset",
      error: `Set ${LOG_DIR_ENV} to an absolute path of Release Desk Log JSONL files.`,
    };
  }
  const read = readLogDir(resolved.dir);
  const lines = read.requests[requestId];
  if (!lines) {
    return { ok: false, source: resolved.source, error: `No log lines for ${requestId}` };
  }
  return {
    ok: true,
    source: resolved.source,
    trace: buildTrace(lines, processes()),
    copy: HANDOFF_COPY,
  };
}
