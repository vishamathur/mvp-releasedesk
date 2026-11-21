import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  bindChild,
  delegateToChildren,
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
  type PolicyDocument,
} from "./policy-corpus.js";
import { failedSubAgentResult, subAgentHooks } from "./sub-agent-hooks.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export type RepoConventionSignals = {
  hasMockScreeningLabel: boolean;
  hasRiskScoring: boolean;
  hasAnalystActions: boolean;
  secretsInDiff: boolean;
};

export async function detectRepoSignals(workspaceRoot: string): Promise<RepoConventionSignals> {
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
      lower.includes("approve") &&
      (lower.includes("reject") || lower.includes("needs_info") || lower.includes("needs-info")),
    secretsInDiff:
      /api[_-]?key\s*[:=]\s*['"][a-z0-9]{16,}/i.test(blob) ||
      /-----BEGIN (RSA )?PRIVATE KEY-----/.test(blob),
  };
}

type StandardsSlice = {
  repository: string;
  policies: PolicyDocument[];
  deviations: ReturnType<typeof evaluatePolicyDeviations>;
  compliant: boolean;
  summary: string;
  evidence: CreateEvidenceInput[];
  mocksUsed: MockMeta[];
};

async function evaluatePolicyRules(
  inv: AgentRunInvocation,
  options: SpecialistRunnerOptions,
): Promise<StandardsSlice> {
  const workspaceRoot = options.workspaceRoot ?? defaultWorkspaceRoot();
  const input = inv.task.input ?? {};
  const repository = asString(input.repository) ?? inv.run.target.repository ?? "unknown/repo";
  const policyRefs = asStringArray(input.policyRefs);
  const changeSummary = asString(input.changeSummary);

  const changeTask = [...inv.run.tasks]
    .reverse()
    .find((t) => t.agentRole === "change_analyst" && t.status === "completed");
  const findings = Array.isArray(changeTask?.output?.findings)
    ? (changeTask.output.findings as Array<{ path?: string }>)
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

  return { repository, policies, deviations, compliant, summary, evidence, mocksUsed };
}

function conventionSummary(signals: RepoConventionSignals): string {
  const notes = [
    signals.hasMockScreeningLabel ? "mock labels present" : "no mock-label marker",
    signals.hasRiskScoring ? "risk scoring mentioned" : "no risk-scoring marker",
    signals.hasAnalystActions ? "analyst actions mentioned" : "no analyst-action marker",
    signals.secretsInDiff ? "secret-like pattern in probed docs" : "no secret-like pattern in probed docs",
  ];
  return `Docs and conventions: ${notes.join("; ")}`;
}

export function createStandardsRunner(options: SpecialistRunnerOptions = {}): AgentRunner {
  const hooks = subAgentHooks(options.subAgents);
  return async (inv: AgentRunInvocation): Promise<AgentRunResult> => {
    const workspaceRoot = options.workspaceRoot ?? defaultWorkspaceRoot();
    let slice: StandardsSlice | undefined;

    const aggregate = await delegateToChildren({
      parentId: "standards",
      context: inv,
      children: [
        bindChild(
          "standards",
          "standards.policy-rules",
          async () => {
            slice = await evaluatePolicyRules(inv, options);
            return {
              summary: slice.summary,
              payload: {
                compliant: slice.compliant,
                deviationCount: slice.deviations.length,
                policiesChecked: slice.policies.map((policy) => policy.id),
              },
            };
          },
          hooks,
        ),
        bindChild(
          "standards",
          "standards.docs-conventions",
          async () => {
            const signals = await detectRepoSignals(workspaceRoot);
            return {
              summary: conventionSummary(signals),
              payload: { ...signals },
            };
          },
          hooks,
        ),
      ],
    });

    if (!slice || aggregate.status === "failed") {
      return failedSubAgentResult("standards", aggregate, {
        ...(slice
          ? {
              compliant: slice.compliant,
              deviations: slice.deviations,
              policiesChecked: slice.policies.map((policy) => policy.id),
            }
          : {}),
      });
    }

    const mocksUsed = [...slice.mocksUsed];
    const evidence = [...slice.evidence];

    if (!options.skipGrok && slice.deviations.length > 0) {
      const grok = await grokComplete(
        `Summarize Northwind standards deviations for ${slice.repository}: ${JSON.stringify(slice.deviations)}`,
        {
          ...options.grok,
          agentRole: options.grok?.agentRole ?? "standards",
          fallback: slice.deviations.map((d) => d.summary).join("; "),
        },
      );
      if (grok.mocked && grok.mock) mocksUsed.push(grok.mock);
      if (!grok.mocked) {
        evidence.push({
          kind: "finding",
          title: "Grok standards narrative",
          summary: grok.text.slice(0, 2000),
          source: "standards",
        });
      }
    }

    const payload = StandardsAgentOutputSchema.parse({
      runId: inv.runId,
      taskId: inv.taskId,
      agentRole: "standards",
      status: "completed",
      completedAt: nowIso(),
      summary: slice.summary,
      evidence: [],
      mocksUsed,
      compliant: slice.compliant,
      deviations: slice.deviations,
      policiesChecked: slice.policies.map((p) => p.id),
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
        subAgents: aggregate,
      },
      evidence,
      mocksUsed,
    };
  };
}
