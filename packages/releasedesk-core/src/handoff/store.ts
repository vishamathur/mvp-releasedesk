import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { HandoffMessage, HumanGateCard } from "./schema.js";
import type { ProcessId, SubAgentId, TeammateId } from "./processes.js";

export type PidStatus = "open" | "blocked" | "ready-for-human" | "done";

export type PidState = {
  requestId: string;
  pid: ProcessId;
  version: string;
  currentStage: string;
  status: PidStatus;
  thread: { channel: "#er-intake" | "#new-customer"; threadId: string };
  customerLabel: string;
  summary: string;
  openedAt: string;
  updatedAt: string;
};

export type StageTransition = {
  seq: number;
  requestId: string;
  pid: ProcessId;
  pidVersion: string;
  fromStage: string | null;
  toStage: string;
  at: string;
  actor: "lead";
  reason: string;
  humanDecision: null | {
    gate: string;
    decision: "approved" | "rejected";
    decidedBy: string;
    at: string;
  };
};

export type StoredMessage = {
  seq: number;
  at: string;
  message: HandoffMessage;
};

export type ThreadPost = {
  seq: number;
  at: string;
  channel: string;
  author: string;
  text: string;
};

export type HumanDecision = {
  seq: number;
  at: string;
  gate: HumanGateCard["gate"];
  decision: "approved" | "rejected";
  decidedBy: string;
  note: string;
};

export type SubAgentEvent = {
  seq: number;
  at: string;
  agent: SubAgentId;
  parent: "builder";
  requestId: string;
  summary: string;
  mock: true;
  cloudClient: "mock";
  parallelGroup: "verify" | null;
};

export type RejectionRecord = {
  seq: number;
  at: string;
  code: string;
  errors: string[];
  requestId?: string;
};

export type StateWrite = {
  seq: number;
  at: string;
  actor: "lead";
  requestId: string;
  fields: string[];
};

export type PendingGate = {
  gate: HumanGateCard["gate"];
  status: "pending";
  decidedBy: null;
  note: string;
  approver: string;
};

export type BuildResultSlice = {
  proposedBranch: string;
  prUrl: string;
  testsPassed: boolean;
  testsSummary: string;
  attempt: number;
};

export type KickoffRecord = {
  sprint: string;
  at: string;
  namedBy: "lead";
  note: string;
};

export type RequestRecord = {
  state: PidState;
  seq: number;
  messages: StoredMessage[];
  transitions: StageTransition[];
  posts: ThreadPost[];
  decisions: HumanDecision[];
  subAgents: SubAgentEvent[];
  rejections: RejectionRecord[];
  stateWrites: StateWrite[];
  artifacts: Record<string, unknown>;
  pendingGate: PendingGate | null;
  lastBuild: BuildResultSlice | null;
  buildAttempts: number;
  remediate: boolean;
  kickoff: KickoffRecord | null;
};

export type HandoffSnapshot = {
  nextSeq: number;
  requests: RequestRecord[];
  rejections: RejectionRecord[];
};

export function emptySnapshot(): HandoffSnapshot {
  return { nextSeq: 1, requests: [], rejections: [] };
}

export interface HandoffStore {
  load(): HandoffSnapshot;
  save(snapshot: HandoffSnapshot): void;
}

export class MemoryHandoffStore implements HandoffStore {
  private snap: HandoffSnapshot = emptySnapshot();

  load(): HandoffSnapshot {
    return structuredClone(this.snap);
  }

  save(snapshot: HandoffSnapshot): void {
    this.snap = structuredClone(snapshot);
  }
}

export class FileHandoffStore implements HandoffStore {
  constructor(private readonly filePath: string) {}

  load(): HandoffSnapshot {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as HandoffSnapshot;
      if (!parsed || !Array.isArray(parsed.requests)) return emptySnapshot();
      return parsed;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptySnapshot();
      throw err;
    }
  }

  save(snapshot: HandoffSnapshot): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }
}

export type TraceEvent = {
  seq: number;
  at: string;
  type: "transition" | "message" | "subagent" | "human" | "post" | "kickoff" | "rejection" | "state";
  text: string;
  from?: string;
  to?: string;
  kind?: string;
  stage?: string;
  channel?: string;
};

export function isTeammate(value: string): value is TeammateId {
  return value === "lead" || value === "change-analyst" || value === "standards" || value === "security" || value === "builder";
}
