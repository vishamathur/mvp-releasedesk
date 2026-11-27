#!/usr/bin/env npx tsx
/**
 * Create (or archive) a Release Desk customer repo. Real `gh` and real HTTP only.
 *
 * Create (after finance approval):
 *   npx tsx scripts/create-customer-repo.ts --customer "Northwind Bank" --customer-id cust_northwind \
 *     --request kyc-identity --request-id REQ-2026-0001 --state /workspace/releasedesk-state/REQ-2026-0001.json \
 *     [--customer-db path] [--audit path] [--owner vishamathur] [--dry-run]
 *
 * Archive on reject:
 *   npx tsx scripts/create-customer-repo.ts --archive --repo vishamathur/acme-ER --request-id REQ-... \
 *     --state path [--key-id <apiKeyId>] [--audit path] [--dry-run]
 *
 * Env: XAI_MANAGEMENT_API_KEY (required to mint or revoke), XAI_TEAM_ID (optional; read from the
 * management key validation endpoint when unset). gh must be logged in with the repo scope.
 * Every failure exits 1 with the real error. Nothing falls back. Secret values are never printed.
 */
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FileCustomerStore } from "../packages/releasedesk-core/src/customer-store.ts";
import {
  branchProtectionBody,
  CustomerRepoError,
  DEFAULT_REQUIRED_CHECKS,
  DEFAULT_KEY_ACLS,
  GROK_KEY_SECRET_NAME,
  grokKeyName,
  auditLine,
  parseLabelsFile,
  planArchiveCustomerRepo,
  planCreateCustomerRepo,
  XAI_MANAGEMENT_KEY_ENV,
  XAI_TEAM_ID_ENV,
  xaiCreateKeyRequest,
  xaiDeleteKeyRequest,
  xaiValidateManagementKeyRequest,
  type HttpRequestSpec,
  type PlanStep,
} from "../packages/releasedesk-core/src/customer-repo/index.ts";

type Args = Record<string, string | true>;

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (!a.startsWith("--")) throw new CustomerRepoError(`unexpected argument ${a}`);
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function need(args: Args, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || !v.trim()) throw new CustomerRepoError(`--${key} is required`);
  return v;
}

function nowIst(): string {
  const d = new Date(Date.now() + 330 * 60_000);
  return `${d.toISOString().slice(0, 19)}+05:30`;
}

/** Run gh. stdin carries secrets; argv never does. Errors carry gh's own stderr. */
function gh(args: string[], input?: string): string {
  try {
    return execFileSync("gh", args, {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    throw new CustomerRepoError(`gh ${args.slice(0, 3).join(" ")} failed: ${(e.stderr || e.message || "").trim()}`);
  }
}

async function xai(spec: HttpRequestSpec): Promise<Record<string, unknown>> {
  const key = process.env[XAI_MANAGEMENT_KEY_ENV]?.trim();
  if (!key) throw new CustomerRepoError(`${XAI_MANAGEMENT_KEY_ENV} is not set; cannot call the xAI Management API`);
  const res = await fetch(spec.url, {
    method: spec.method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    ...(spec.body ? { body: JSON.stringify(spec.body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new CustomerRepoError(`xAI Management API ${spec.method} ${new URL(spec.url).pathname} returned ${res.status}: ${text.replace(/xai-[A-Za-z0-9]+/g, "xai-[redacted]").slice(0, 400)}`);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function resolveTeamId(): Promise<string> {
  const fromEnv = process.env[XAI_TEAM_ID_ENV]?.trim();
  if (fromEnv) return fromEnv;
  const meta = await xai(xaiValidateManagementKeyRequest());
  const team = meta.scope === "SCOPE_TEAM" ? meta.scopeId : meta.teamId;
  if (typeof team !== "string" || !team) {
    throw new CustomerRepoError(`management key has no team scope; set ${XAI_TEAM_ID_ENV}`);
  }
  return team;
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 1)}\n`);
}

function printPlan(title: string, steps: PlanStep[]): void {
  process.stdout.write(`${title}\n`);
  for (const s of steps) {
    const how = s.gh ? `gh ${s.gh.join(" ")}` : s.http ? `${s.http.method} ${s.http.url}` : "local file write";
    process.stdout.write(`  - ${s.id}: ${s.description}\n      ${how}\n`);
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function create(args: Args): Promise<void> {
  const statePath = need(args, "state");
  const options = {
    customerId: need(args, "customer-id"),
    customerName: need(args, "customer"),
    request: need(args, "request"),
    requestId: need(args, "request-id"),
    statePath,
    customerDbPath: typeof args["customer-db"] === "string" ? args["customer-db"] : new FileCustomerStore().filePath,
    auditPath: typeof args.audit === "string" ? args.audit : "releasedesk-log/customer-repos.audit.jsonl",
    ...(typeof args.owner === "string" ? { owner: args.owner } : {}),
    requiredChecks: DEFAULT_REQUIRED_CHECKS,
    keyAcls: DEFAULT_KEY_ACLS,
  };
  const state = await readJson(statePath);
  const plan = planCreateCustomerRepo(options, state);
  printPlan(`create ${plan.repository} (finance approved by ${plan.financeApproval.decidedBy})`, plan.steps);
  if (args["dry-run"]) {
    process.stdout.write("dry run: nothing was called or written\n");
    return;
  }
  const repo = plan.repository;

  // check-free: gh repo view must fail with "Could not resolve".
  let exists = true;
  try {
    gh(["repo", "view", repo, "--json", "name"]);
  } catch (err) {
    if (!String((err as Error).message).includes("Could not resolve")) throw err;
    exists = false;
  }
  if (exists) throw new CustomerRepoError(`${repo} already exists; refusing to reuse or rename it`);

  const createStep = plan.steps.find((s) => s.id === "create");
  if (!createStep?.gh) throw new CustomerRepoError("plan has no create step");
  gh(createStep.gh);
  process.stdout.write(`created ${repo}\n`);

  // Template generation is asynchronous; wait up to 60 s for the base branch.
  let ready = false;
  for (let i = 0; i < 20 && !ready; i += 1) {
    try {
      gh(["api", `repos/${repo}/branches/${plan.baseRef}`]);
      ready = true;
    } catch {
      await sleep(3000);
    }
  }
  if (!ready) throw new CustomerRepoError(`${repo} has no ${plan.baseRef} branch after 60 s`);

  // Protection: a 403 (for example a private repo on GitHub Free) stops the run with GitHub's message.
  gh(
    ["api", "-X", "PUT", `repos/${repo}/branches/${plan.baseRef}/protection`, "--input", "-"],
    JSON.stringify(branchProtectionBody(options.requiredChecks)),
  );
  process.stdout.write(`protected ${plan.baseRef}\n`);

  const labelsText = gh(["api", `repos/${repo}/contents/.github/labels.yml`, "-H", "Accept: application/vnd.github.raw"]);
  for (const label of parseLabelsFile(labelsText)) {
    gh(["label", "create", label.name, "--color", label.color, "--description", label.description, "--force", "-R", repo]);
  }

  const teamId = await resolveTeamId();
  const created = await xai(xaiCreateKeyRequest(teamId, grokKeyName(repo), options.keyAcls));
  const apiKey = created.apiKey;
  const apiKeyId = typeof created.apiKeyId === "string" ? created.apiKeyId : null;
  if (typeof apiKey !== "string" || !apiKey || !apiKeyId) {
    throw new CustomerRepoError("xAI Management API did not return apiKey and apiKeyId");
  }
  try {
    gh(["secret", "set", GROK_KEY_SECRET_NAME, "-R", repo], apiKey);
  } catch (err) {
    // Do not leave a live key that no repo holds.
    await xai(xaiDeleteKeyRequest(apiKeyId));
    throw err;
  }
  process.stdout.write(`set ${GROK_KEY_SECRET_NAME} on ${repo} (key id ${apiKeyId}; value not shown)\n`);

  const at = nowIst();
  const store = new FileCustomerStore({ filePath: options.customerDbPath });
  const existing = await store.getCustomer(options.customerId);
  await store.upsertCustomer({
    customerId: options.customerId,
    name: existing?.name ?? options.customerName,
    metadata: { ...(existing?.metadata ?? {}), repository: repo, baseRef: plan.baseRef },
  });

  const fresh = await readJson(statePath);
  fresh.target = {
    repository: repo,
    baseRef: plan.baseRef,
    source: "create-customer-repo",
    setAt: at,
    setBy: `create-customer-repo (finance approved by ${plan.financeApproval.decidedBy})`,
    grokKeyId: apiKeyId,
  };
  await writeJson(statePath, fresh);

  await mkdir(path.dirname(options.auditPath), { recursive: true });
  await appendFile(
    options.auditPath,
    auditLine({
      schema: "customer-repo-audit.v1",
      action: "create",
      requestId: options.requestId,
      repository: repo,
      baseRef: plan.baseRef,
      financeApprovedBy: plan.financeApproval.decidedBy,
      grokKeyId: apiKeyId,
      protection: "applied",
      at,
      by: "create-customer-repo",
    }),
  );
  process.stdout.write(`done: ${repo}\n`);
}

async function archive(args: Args): Promise<void> {
  const statePath = need(args, "state");
  const options = {
    repository: need(args, "repo"),
    requestId: need(args, "request-id"),
    statePath,
    auditPath: typeof args.audit === "string" ? args.audit : "releasedesk-log/customer-repos.audit.jsonl",
    ...(typeof args["key-id"] === "string" ? { apiKeyId: args["key-id"] } : {}),
  };
  const state = await readJson(statePath);
  const plan = planArchiveCustomerRepo(options, state);
  printPlan(`archive ${plan.repository} (rejected ${plan.rejection.gate} by ${plan.rejection.decidedBy})`, plan.steps);
  if (args["dry-run"]) {
    process.stdout.write("dry run: nothing was called or written\n");
    return;
  }
  await xai(xaiDeleteKeyRequest(plan.apiKeyId ?? ""));
  gh(["secret", "delete", GROK_KEY_SECRET_NAME, "-R", plan.repository]);
  gh(["repo", "archive", plan.repository, "--yes"]);
  const at = nowIst();
  const fresh = await readJson(statePath);
  const target = (fresh.target as Record<string, unknown> | undefined) ?? { repository: plan.repository };
  fresh.target = { ...target, archivedAt: at, grokKeyRevokedAt: at };
  await writeJson(statePath, fresh);
  await mkdir(path.dirname(options.auditPath), { recursive: true });
  await appendFile(
    options.auditPath,
    auditLine({
      schema: "customer-repo-audit.v1",
      action: "archive",
      requestId: options.requestId,
      repository: plan.repository,
      rejectedBy: plan.rejection.decidedBy,
      rejectedGate: plan.rejection.gate,
      grokKeyId: plan.apiKeyId,
      protection: "not-applied",
      at,
      by: "create-customer-repo --archive",
    }),
  );
  process.stdout.write(`archived ${plan.repository}; Grok key ${plan.apiKeyId} deleted\n`);
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry!).href;
}

if (isDirectRun()) {
  const args = parseArgs(process.argv.slice(2));
  (args.archive ? archive(args) : create(args)).catch((err: unknown) => {
    process.stderr.write(`create-customer-repo: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
