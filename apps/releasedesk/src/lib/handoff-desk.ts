import path from "node:path";
import {
  FileHandoffStore,
  HandoffEngine,
  type HumanGateId,
  type ProcessId,
  type RequestView,
} from "@releasedesk/core";

function workspaceRoot(): string {
  if (process.cwd().endsWith(`${path.sep}releasedesk`) || process.cwd().endsWith("/releasedesk")) {
    return path.join(process.cwd(), "..", "..");
  }
  return process.cwd();
}

export function handoffStorePath(root = workspaceRoot()): string {
  return path.join(root, "apps", "releasedesk", "data", "handoff.json");
}

export function createHandoffEngine(storePath = handoffStorePath()): HandoffEngine {
  return new HandoffEngine({
    workspaceRoot: workspaceRoot(),
    store: new FileHandoffStore(storePath),
  });
}

let singleton: HandoffEngine | undefined;

export function getHandoffEngine(): HandoffEngine {
  if (!singleton) singleton = createHandoffEngine();
  return singleton;
}

export function resetHandoffEngine(): void {
  singleton = undefined;
}

export type HandoffCatalog = {
  cloudClient: "mock";
  roster: ReturnType<HandoffEngine["roster"]>;
  processes: Array<{
    id: ProcessId;
    version: string;
    title: string;
    summary: string;
    channel: "#er-intake" | "#new-customer";
    stages: RequestView["stages"];
  }>;
  requests: Array<{
    requestId: string;
    pid: ProcessId;
    status: RequestView["state"]["status"];
    currentStage: string;
    customerLabel: string;
    summary: string;
    updatedAt: string;
    pendingGate: RequestView["pendingGate"];
  }>;
};

export function handoffCatalog(engine = getHandoffEngine()): HandoffCatalog {
  return {
    cloudClient: "mock",
    roster: engine.roster(),
    processes: engine.listProcesses().map((process) => ({
      id: process.id,
      version: process.version,
      title: process.title,
      summary: process.summary,
      channel: process.entry.channel,
      stages: process.stages.map((stage) => ({
        id: stage.id,
        name: stage.name,
        owner: stage.owner,
        consulting: [...stage.consulting],
        humanApprover: stage.humanApprover,
        current: false,
        reached: false,
      })),
    })),
    requests: engine.listRequests().map((request) => ({
      requestId: request.state.requestId,
      pid: request.state.pid,
      status: request.state.status,
      currentStage: request.state.currentStage,
      customerLabel: request.state.customerLabel,
      summary: request.state.summary,
      updatedAt: request.state.updatedAt,
      pendingGate: request.pendingGate,
    })),
  };
}

export function isProcessId(value: string): value is ProcessId {
  return value === "PID-ER" || value === "PID-NC";
}

export function isHumanGateId(value: string): value is HumanGateId {
  return (
    value === "proposal" ||
    value === "finance-approval" ||
    value === "security-compliance-approval" ||
    value === "release-gate"
  );
}
