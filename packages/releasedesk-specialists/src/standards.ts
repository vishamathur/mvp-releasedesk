import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  nowIso,
  StandardsAgentOutputSchema,
  type CreateEvidenceInput,
  type MockMeta,
} from "@releasedesk/core";
import type { AgentRunner, AgentRunInvocation, AgentRunResult } from "@releasedesk/lead";
import { grokComplete } from "./grok.js";
import type { SpecialistRunnerOptions } from "./options.js";
import { defaultWorkspaceRoot, policiesDir } from "./paths.js";
import {
  evaluatePolicyDeviations,
  loadPolicyCorpus,
  selectPolicies,
} from "./policy-corpus.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

async function detectRepoSignals(workspaceRoot: string): Promise<{
  hasMockScreeningLabel: boolean;
  hasRiskScoring: boolean;
  hasAnalystActions: boolean;
  secretsInDiff: boolean;
}> {
  const probes = [
    path.join(workspaceRoot, "apps/kyc/src/lib/domain/risk.ts"),
    path.join(workspaceRoot, "apps/kyc/README.md"),
    path.join(workspaceRoot, "README.md"),
    path.join(workspaceRoot, "packages/releasedesk-lead/src/orchestrator.ts"),
  ];

  let blob = "";
  for (const file of probes) {
    try {
      blob += `\n${await readFile(file, "utf8")}`;
    } catch {
      // optional
    }
  }
  const lower = blob.toLowerCase();
  return {
    hasMockScreeningLabel: blob.includes("MOCK:") || lower.includes("mock:"),
    hasRiskScoring: lower.includes("risk") && (lower.includes("score") || lower.includes("screening")),
    hasAnalystActions:
      lower.includes("approve") && (lower.includes("reject") || lower.includes("needs_info") || lower.includes("needs-info")),
    secretsInDiff:
      /api[_-]?key\s*[:=]\s*['"][a-z0-9]{16,}/i.test(blob) ||
      /-----BEGIN (RSA )?PRIVATE KEY-----/.test(blob),
  };
}

export function createStandardsRunner(options: SpecialistRunnerOptions = {}): AgentRunner {
  return async (inv: AgentRunInvocation): Promise<AgentRunResult> => {
    const workspaceRoot = options.workspaceRoot ?? defaultWorkspaceRoot();
    const input = inv.task.input ?? {};
    const repository =
      asString(input.repository) ?? inv.run.target.repository ?? "unknown/repo";
    const policyRefs = asStringArray(input.policyRefs);
    const changeSummary = asString(input.changeSummary);

    // Pull changed paths from prior change_analyst output when present on the run.
    const changeTask = [...inv.run.tasks]
      .reverse()
      .find((t) => t.agentRole === "change_analyst" && t.status === "completed");
    const findings = Array.isArray(changeTask?.output?.findings)
      ? (changeTask!.output!.findings as Array<{ path?: string }>)
      : [];
    const changedPaths = findings
      .map((f) => f.path)
      .filter((p): p is string => typeof p === "string");

    const mocksUsed: MockMeta[] = [];
    const evidence: CreateEvidenceInput[] = [];

    const corpus = await loadPolicyCorpus(options.policiesDir ?? policiesDir());
    const policies = selectPolicies(corpus, policyRefs.length ? policyRefs : ["northwind-kyc-baseline"]);

    for (const policy of policies) {
      evidence.push({
        kind: "policy_ref",
        title: policy.title,
        summary: `Evaluated policy ${policy.id} (${policy.requirements.length} requirement(s))`,
        source: "standards",
        uri: policy.filePath,
        data: { policyId: policy.id, requirements: policy.requirements.slice(0, 20) },
      });
    }

    const repoSignals = await detectRepoSignals(workspaceRoot);
    const deviations = evaluatePolicyDeviations({
      policies,
      ...(changeSummary !== undefined ? { changeSummary } : {}),
      changedPaths,
      repoSignals: {
        ...repoSignals,
        hasHumanApprovalGates: options.assumeLeadHumanGates ?? true,
      },
    });

    const grok = await grokComplete(
      `Summarize Northwind standards deviations for ${repository}: ${JSON.stringify(deviations)}`,
      {
        ...options.grok,
        agentRole: options.grok?.agentRole ?? "standards",
        safetySource: inv.runId,
      },
    );
    evidence.push({
      kind: "finding",
      title: "Grok standards narrative",
      summary: grok.text.slice(0, 2000),
      source: "standards",
    });

    // Fixture corpus itself is real in-repo content — not mocked.
    // Only mark MOCK when we fabricated screening labels elsewhere.
    const compliant = deviations.length === 0;
    const summary = compliant
      ? `Standards check complete — compliant (${policies.map((p) => p.id).join(", ")})`
      : `Standards check complete — ${deviations.length} deviation(s) against Northwind policies`;

    if (!compliant) {
      for (const d of deviations) {
        evidence.push({
          kind: "finding",
          title: `Deviation: ${d.policyRef}`,
          summary: d.summary,
          source: "standards",
          data: { ...d },
        });
      }
    }

    const payload = StandardsAgentOutputSchema.parse({
      runId: inv.runId,
      taskId: inv.taskId,
      agentRole: "standards",
      status: "completed",
      completedAt: nowIso(),
      summary,
      evidence: [],
      mocksUsed,
      compliant,
      deviations,
      policiesChecked: policies.map((p) => p.id),
    });

    return {
      status: "completed",
      summary: payload.summary,
      payload: {
        agentRole: payload.agentRole,
        compliant: payload.compliant,
        deviations: payload.deviations,
        policiesChecked: payload.policiesChecked,
        evidence: payload.evidence,
        mocksUsed: payload.mocksUsed,
      },
      evidence,
      mocksUsed,
    };
  };
}
