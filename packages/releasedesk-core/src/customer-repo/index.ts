/**
 * Customer repo setup for Release Desk.
 *
 * A customer repo is created only after the request's finance-approval gate is approved.
 * Name rule: `<customer>-ER` or `<customer>-<request>`, lowercase words joined by dashes
 * (the literal `ER` suffix stays uppercase), for example `acme-ER` or `acme-kyc-occupation`.
 *
 * This module is pure: names, guards, plans and request bodies. The CLI
 * `scripts/create-customer-repo.ts` runs the plan with real `gh` and real HTTP calls.
 */

export const DEFAULT_REPO_OWNER = "vishamathur";
export const DEFAULT_TEMPLATE_REPO = "vishamathur/releasedesk-customer-template";
export const DEFAULT_BASE_REF = "main";
export const GROK_KEY_SECRET_NAME = "RELEASEDESK_GROK_API_KEY_LEAD";
export const XAI_MANAGEMENT_API_BASE = "https://management-api.x.ai";
export const XAI_MANAGEMENT_KEY_ENV = "XAI_MANAGEMENT_API_KEY";
export const XAI_TEAM_ID_ENV = "XAI_TEAM_ID";
/** Check-run names in a repo created from the template (caller job / reusable job). */
export const DEFAULT_REQUIRED_CHECKS = ["ci", "grok-review / review", "owasp-review / review"];
/** Least privilege for the per-repo Grok key: chat endpoint and the harness default model. */
export const DEFAULT_KEY_ACLS = ["api-key:endpoint:chat", "api-key:model:grok-4.3"];
const GITHUB_REPO_NAME_MAX = 100;

export class CustomerRepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerRepoError";
  }
}

/** Lowercase words joined by single dashes. Throws when nothing usable is left. */
export function slugPart(value: string, label: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new CustomerRepoError(`${label} "${value}" has no letters or digits`);
  return slug;
}

const NAME_RULE = /^[a-z0-9]+(?:-[a-z0-9]+)*-(?:ER|[a-z0-9]+(?:-[a-z0-9]+)*)$/;

export type NameCheck = { ok: true } | { ok: false; reason: string };

export function validateCustomerRepoName(name: string): NameCheck {
  if (name.length > GITHUB_REPO_NAME_MAX) {
    return { ok: false, reason: `longer than ${GITHUB_REPO_NAME_MAX} characters` };
  }
  if (!NAME_RULE.test(name)) {
    return {
      ok: false,
      reason: "must be <customer>-ER or <customer>-<request>: lowercase words joined by dashes",
    };
  }
  return { ok: true };
}

/** Build the repo name from the customer name and `ER` or a request slug. */
export function customerRepoName(customerName: string, request: string): string {
  const customer = slugPart(customerName, "customer name");
  const trimmed = request.trim();
  const suffix = trimmed === "ER" || trimmed === "er" ? "ER" : slugPart(trimmed, "request slug");
  if (suffix === "er") throw new CustomerRepoError('use "ER" for the generic enhancement suffix');
  const name = `${customer}-${suffix}`;
  const check = validateCustomerRepoName(name);
  if (!check.ok) throw new CustomerRepoError(`repo name "${name}" ${check.reason}`);
  return name;
}

export type GateRecord = {
  gate: string;
  status: string;
  decidedBy: string;
  note?: string;
};

function gateRecords(state: Record<string, unknown>): GateRecord[] {
  const out: GateRecord[] = [];
  const push = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const r = value as Record<string, unknown>;
    if (typeof r.gate === "string" && typeof r.status === "string" && typeof r.decidedBy === "string") {
      out.push({
        gate: r.gate,
        status: r.status,
        decidedBy: r.decidedBy,
        ...(typeof r.note === "string" ? { note: r.note } : {}),
      });
    }
  };
  if (Array.isArray(state.decisions)) state.decisions.forEach(push);
  if (Array.isArray(state.transitions)) {
    for (const t of state.transitions) {
      if (t && typeof t === "object") push((t as Record<string, unknown>).humanDecision);
    }
  }
  return out;
}

function asState(state: unknown, requestId: string): Record<string, unknown> {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new CustomerRepoError("request state is not a JSON object");
  }
  const s = state as Record<string, unknown>;
  if (s.requestId !== requestId) {
    throw new CustomerRepoError(
      `request state is for ${String(s.requestId ?? "no request")}, not ${requestId}`,
    );
  }
  return s;
}

/**
 * Refuse unless the request state holds an approved finance-approval decision with a named
 * human decider. Returns that decision for the audit line.
 */
export function requireFinanceApproval(state: unknown, requestId: string): GateRecord {
  const s = asState(state, requestId);
  const records = gateRecords(s).filter((r) => r.gate === "finance-approval");
  const approved = records.find((r) => r.status === "approved" && r.decidedBy.trim().length > 0);
  if (!approved) {
    const seen = records.map((r) => r.status).join(", ") || "none";
    throw new CustomerRepoError(
      `${requestId} has no approved finance-approval decision (found: ${seen}). A customer repo is created only after finance approval.`,
    );
  }
  return approved;
}

/** Archive-on-reject needs a rejected human gate decision on the request. */
export function requireRejection(state: unknown, requestId: string): GateRecord {
  const s = asState(state, requestId);
  const rejected = gateRecords(s).find((r) => r.status === "rejected" && r.decidedBy.trim().length > 0);
  if (!rejected) {
    throw new CustomerRepoError(`${requestId} has no rejected gate decision; refusing to archive`);
  }
  return rejected;
}

export function branchProtectionBody(requiredChecks: string[]) {
  return {
    required_status_checks: { strict: true, contexts: requiredChecks },
    enforce_admins: false,
    required_pull_request_reviews: {
      required_approving_review_count: 1,
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
    },
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
  };
}

export type HttpRequestSpec = {
  method: "GET" | "POST" | "DELETE";
  url: string;
  body?: Record<string, unknown>;
};

/** POST /auth/teams/{teamId}/api-keys (xAI Management API reference). */
export function xaiCreateKeyRequest(teamId: string, name: string, acls = DEFAULT_KEY_ACLS): HttpRequestSpec {
  if (!teamId.trim()) throw new CustomerRepoError(`${XAI_TEAM_ID_ENV} is empty`);
  return {
    method: "POST",
    url: `${XAI_MANAGEMENT_API_BASE}/auth/teams/${encodeURIComponent(teamId)}/api-keys`,
    body: { name, acls },
  };
}

/** DELETE /auth/api-keys/{apiKeyId}: permanently deletes the key. */
export function xaiDeleteKeyRequest(apiKeyId: string): HttpRequestSpec {
  if (!apiKeyId.trim()) throw new CustomerRepoError("no Grok apiKeyId recorded for this repo");
  return { method: "DELETE", url: `${XAI_MANAGEMENT_API_BASE}/auth/api-keys/${encodeURIComponent(apiKeyId)}` };
}

/** GET /auth/management-keys/validation: returns the management key's scope and team. */
export function xaiValidateManagementKeyRequest(): HttpRequestSpec {
  return { method: "GET", url: `${XAI_MANAGEMENT_API_BASE}/auth/management-keys/validation` };
}

export function grokKeyName(repository: string): string {
  return `releasedesk-${repository.replace("/", "-")}`;
}

export type CreateOptions = {
  owner?: string;
  customerId: string;
  customerName: string;
  /** `ER` or a request slug such as `kyc-identity`. */
  request: string;
  requestId: string;
  statePath: string;
  customerDbPath: string;
  auditPath: string;
  template?: string;
  baseRef?: string;
  requiredChecks?: string[];
  keyAcls?: string[];
};

export type PlanStep = {
  id: string;
  description: string;
  /** Exact `gh` argv when the step is a gh call. Never holds a secret. */
  gh?: string[];
  http?: HttpRequestSpec;
};

export type CreatePlan = {
  repository: string;
  name: string;
  baseRef: string;
  financeApproval: GateRecord;
  steps: PlanStep[];
};

/** Build the full create plan. Runs the name rule and the finance guard first. */
export function planCreateCustomerRepo(options: CreateOptions, state: unknown): CreatePlan {
  const owner = options.owner ?? DEFAULT_REPO_OWNER;
  const name = customerRepoName(options.customerName, options.request);
  const financeApproval = requireFinanceApproval(state, options.requestId);
  const repository = `${owner}/${name}`;
  const baseRef = options.baseRef ?? DEFAULT_BASE_REF;
  const template = options.template ?? DEFAULT_TEMPLATE_REPO;
  const checks = options.requiredChecks ?? DEFAULT_REQUIRED_CHECKS;
  const steps: PlanStep[] = [
    { id: "check-free", description: `confirm ${repository} does not exist yet`, gh: ["repo", "view", repository, "--json", "name"] },
    {
      id: "create",
      description: `create private ${repository} from template ${template}`,
      gh: ["repo", "create", repository, "--private", "--template", template],
    },
    { id: "wait-main", description: `wait for ${baseRef} to exist`, gh: ["api", `repos/${repository}/branches/${baseRef}`] },
    {
      id: "protect",
      description: `protect ${baseRef}: PR required, 1 review, checks ${checks.join(", ")}, no force-push, no deletion`,
      gh: ["api", "-X", "PUT", `repos/${repository}/branches/${baseRef}/protection`, "--input", "-"],
    },
    { id: "labels", description: "create labels from .github/labels.yml", gh: ["label", "create", "<name>", "--color", "<color>", "--description", "<desc>", "--force", "-R", repository] },
    {
      id: "mint-key",
      description: `mint a per-repo Grok key "${grokKeyName(repository)}" (ACLs ${(options.keyAcls ?? DEFAULT_KEY_ACLS).join(", ")})`,
      http: xaiCreateKeyRequest("<XAI_TEAM_ID>", grokKeyName(repository), options.keyAcls ?? DEFAULT_KEY_ACLS),
    },
    {
      id: "set-secret",
      description: `set ${GROK_KEY_SECRET_NAME} on ${repository} from stdin (value never printed)`,
      gh: ["secret", "set", GROK_KEY_SECRET_NAME, "-R", repository],
    },
    { id: "customer-record", description: `write repository ${repository}, baseRef ${baseRef} to customer ${options.customerId} in ${options.customerDbPath}` },
    { id: "request-target", description: `write target to ${options.statePath}` },
    { id: "audit", description: `append audit line to ${options.auditPath} (finance approved by ${financeApproval.decidedBy})` },
  ];
  return { repository, name, baseRef, financeApproval, steps };
}

export type ArchiveOptions = {
  repository: string;
  requestId: string;
  statePath: string;
  auditPath: string;
  apiKeyId?: string;
};

export function planArchiveCustomerRepo(options: ArchiveOptions, state: unknown) {
  const rejection = requireRejection(state, options.requestId);
  const target = (state as Record<string, unknown>).target as Record<string, unknown> | undefined;
  if (target && typeof target.repository === "string" && target.repository !== options.repository) {
    throw new CustomerRepoError(
      `${options.requestId} targets ${target.repository}, not ${options.repository}; refusing to archive`,
    );
  }
  const apiKeyId = options.apiKeyId ?? (typeof target?.grokKeyId === "string" ? target.grokKeyId : undefined);
  const steps: PlanStep[] = [
    { id: "revoke-key", description: "delete the per-repo Grok key", http: xaiDeleteKeyRequest(apiKeyId ?? "") },
    { id: "delete-secret", description: `delete ${GROK_KEY_SECRET_NAME}`, gh: ["secret", "delete", GROK_KEY_SECRET_NAME, "-R", options.repository] },
    { id: "archive", description: `archive ${options.repository}`, gh: ["repo", "archive", options.repository, "--yes"] },
    { id: "request-target", description: `mark target archived in ${options.statePath}` },
    { id: "audit", description: `append audit line to ${options.auditPath} (rejected ${rejection.gate} by ${rejection.decidedBy})` },
  ];
  return { repository: options.repository, rejection, apiKeyId: apiKeyId ?? null, steps };
}

export type AuditLine = {
  schema: "customer-repo-audit.v1";
  action: "create" | "archive";
  requestId: string;
  repository: string;
  baseRef?: string;
  financeApprovedBy?: string;
  rejectedBy?: string;
  rejectedGate?: string;
  grokKeyId?: string | null;
  protection: "applied" | "not-applied";
  at: string;
  by: string;
};

export function auditLine(line: AuditLine): string {
  return `${JSON.stringify(line)}\n`;
}

/** Parse the template's one-entry-per-line labels file (`- { name: "...", color: "...", description: "..." }`). */
export function parseLabelsFile(text: string): { name: string; color: string; description: string }[] {
  const out: { name: string; color: string; description: string }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("- {")) continue;
    const field = (key: string) => line.match(new RegExp(`${key}:\\s*"([^"]*)"`))?.[1];
    const name = field("name");
    const color = field("color");
    if (!name || !color || !/^[0-9a-fA-F]{6}$/.test(color)) {
      throw new CustomerRepoError(`labels file has an invalid entry: ${line}`);
    }
    out.push({ name, color, description: field("description") ?? "" });
  }
  return out;
}
