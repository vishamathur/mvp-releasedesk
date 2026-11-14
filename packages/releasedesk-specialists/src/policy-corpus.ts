import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { policiesDir } from "./paths.js";

export type PolicyDocument = {
  id: string;
  title: string;
  filePath: string;
  body: string;
  requirements: string[];
};

const POLICY_ID_RE = /Policy ID:\s*`?([a-z0-9][a-z0-9\-_/]*)`?/i;

function extractRequirements(body: string): string[] {
  const lines = body.split("\n");
  const reqs: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\d+\.\s+\*\*([^*]+)\*\*\s+[—–-]\s+(.+)$/);
    if (m) {
      reqs.push(`${m[1]!.trim()}: ${m[2]!.trim()}`);
      continue;
    }
    const m2 = line.match(/^\d+\.\s+(.+)$/);
    if (m2) reqs.push(m2[1]!.trim());
  }
  return reqs;
}

function extractPolicyId(body: string, fallbackFile: string): string {
  const m = body.match(POLICY_ID_RE);
  if (m?.[1]) return m[1];
  return path.basename(fallbackFile, path.extname(fallbackFile));
}

function extractTitle(body: string, fallback: string): string {
  const line = body.split("\n").find((l) => l.startsWith("# "));
  return line ? line.replace(/^#\s+/, "").trim() : fallback;
}

export async function loadPolicyCorpus(dir = policiesDir()): Promise<PolicyDocument[]> {
  const entries = await readdir(dir);
  const docs: PolicyDocument[] = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const filePath = path.join(dir, name);
    const body = await readFile(filePath, "utf8");
    const id = extractPolicyId(body, name);
    docs.push({
      id,
      title: extractTitle(body, name),
      filePath,
      body,
      requirements: extractRequirements(body),
    });
  }
  return docs.sort((a, b) => a.id.localeCompare(b.id));
}

export function selectPolicies(
  corpus: PolicyDocument[],
  policyRefs: string[],
): PolicyDocument[] {
  if (policyRefs.length === 0) return corpus;
  const wanted = new Set(policyRefs.map((p) => p.toLowerCase()));
  const matched = corpus.filter(
    (p) =>
      wanted.has(p.id.toLowerCase()) ||
      [...wanted].some((w) => p.id.toLowerCase().includes(w) || w.includes(p.id.toLowerCase())),
  );
  return matched.length > 0 ? matched : corpus;
}

/**
 * Evaluate Northwind policies against change text / repo signals.
 * Returns evidence-backed deviations (heuristic; Grok may enrich later).
 */
export function evaluatePolicyDeviations(opts: {
  policies: PolicyDocument[];
  changeSummary?: string;
  changedPaths?: string[];
  repoSignals?: {
    hasMockScreeningLabel?: boolean;
    hasRiskScoring?: boolean;
    hasAnalystActions?: boolean;
    hasHumanApprovalGates?: boolean;
    secretsInDiff?: boolean;
  };
}): Array<{
  policyRef: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  summary: string;
  recommendation?: string;
}> {
  const deviations: Array<{
    policyRef: string;
    severity: "info" | "low" | "medium" | "high" | "critical";
    summary: string;
    recommendation?: string;
  }> = [];

  const text = `${opts.changeSummary ?? ""}\n${(opts.changedPaths ?? []).join("\n")}`.toLowerCase();
  const signals = opts.repoSignals ?? {};

  for (const policy of opts.policies) {
    if (policy.id === "northwind-kyc-baseline") {
      if (signals.hasRiskScoring === true && signals.hasMockScreeningLabel === false) {
        deviations.push({
          policyRef: policy.id,
          severity: "high",
          summary:
            "Risk / screening path present without MOCK: labeling evidence for fabricated vendor results.",
          recommendation: "Ensure screening notes use the MOCK: prefix when vendor APIs are stubbed.",
        });
      }
      if (signals.hasAnalystActions === false) {
        deviations.push({
          policyRef: policy.id,
          severity: "medium",
          summary: "Analyst approve/reject/needs-info controls not detected in evaluated signals.",
          recommendation: "Confirm analyst actions remain available before release.",
        });
      }
      if (text.includes("auto-approve") && text.includes("kyc")) {
        deviations.push({
          policyRef: policy.id,
          severity: "critical",
          summary: "Change text references KYC auto-approval, which this policy prohibits.",
          recommendation: "Remove silent KYC auto-approval paths.",
        });
      }
    }

    if (policy.id === "northwind-data-retention") {
      if (signals.secretsInDiff === true) {
        deviations.push({
          policyRef: policy.id,
          severity: "critical",
          summary: "Diff signals suggest secrets or credential material may be present.",
          recommendation: "Remove secrets from source control and rotate credentials.",
        });
      }
      if (text.includes("government id") && text.includes("console.log")) {
        deviations.push({
          policyRef: policy.id,
          severity: "high",
          summary: "Possible logging of government ID material referenced in change summary.",
          recommendation: "Redact PII from application logs.",
        });
      }
    }

    if (policy.id === "northwind-auth-standards") {
      if (signals.hasHumanApprovalGates === false) {
        deviations.push({
          policyRef: policy.id,
          severity: "high",
          summary: "Human merge/release approval gates not detected for regulated release flow.",
          recommendation: "Keep Lead human approval gates pending until a human decides.",
        });
      }
    }
  }

  return deviations;
}
