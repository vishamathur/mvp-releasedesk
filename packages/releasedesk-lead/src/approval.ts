import { nowIso } from "@releasedesk/core";

/**
 * Human approval gates for merge / release decisions.
 * Modeled explicitly — never auto-approved by the Lead.
 */

export type ApprovalKind = "merge" | "release";
export type ApprovalDecision = "pending" | "approved" | "rejected";

export type ApprovalGate = {
  id: string;
  kind: ApprovalKind;
  status: ApprovalDecision;
  requestedAt: string;
  reason: string;
  decidedAt?: string;
  decidedBy?: string;
  notes?: string;
};

export type ApprovalRecord = {
  gates: ApprovalGate[];
};

let approvalSeq = 0;

export function createApprovalGate(kind: ApprovalKind, reason: string): ApprovalGate {
  approvalSeq += 1;
  return {
    id: `approval_${kind}_${approvalSeq}_${Date.now()}`,
    kind,
    status: "pending",
    requestedAt: nowIso(),
    reason,
  };
}

export function recordApprovalDecision(
  gate: ApprovalGate,
  decision: Exclude<ApprovalDecision, "pending">,
  opts?: { decidedBy?: string; notes?: string },
): ApprovalGate {
  if (gate.status !== "pending") {
    throw new Error(`Approval gate ${gate.id} is already ${gate.status}`);
  }
  return {
    ...gate,
    status: decision,
    decidedAt: nowIso(),
    ...(opts?.decidedBy !== undefined ? { decidedBy: opts.decidedBy } : {}),
    ...(opts?.notes !== undefined ? { notes: opts.notes } : {}),
  };
}

export function getPendingGates(record: ApprovalRecord | undefined): ApprovalGate[] {
  return (record?.gates ?? []).filter((g) => g.status === "pending");
}

export function allReleaseGatesApproved(record: ApprovalRecord | undefined): boolean {
  const gates = record?.gates ?? [];
  const releaseGates = gates.filter((g) => g.kind === "release");
  if (releaseGates.length === 0) return false;
  return releaseGates.every((g) => g.status === "approved");
}

export function anyGateRejected(record: ApprovalRecord | undefined): boolean {
  return (record?.gates ?? []).some((g) => g.status === "rejected");
}

export function parseApprovalRecord(raw: unknown): ApprovalRecord {
  if (!raw || typeof raw !== "object") return { gates: [] };
  const gates = (raw as { gates?: ApprovalGate[] }).gates;
  return { gates: Array.isArray(gates) ? gates : [] };
}
