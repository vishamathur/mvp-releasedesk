import {
  createMockMeta,
  nowIso,
  SecurityAgentOutputSchema,
  type CreateEvidenceInput,
  type MockMeta,
  type SecurityFinding,
} from "@releasedesk/core";
import type { AgentRunner, AgentRunInvocation, AgentRunResult } from "@releasedesk/lead";
import { riskLevelFromFindings, type ComponentRef } from "./advisories.js";
import {
  enforceFrameworkHardFail,
  reviewAiSurfaceAgainstFrameworks,
} from "./ai-framework-review.js";
import { discoverNpmComponents } from "./components.js";
import { grokComplete } from "./grok.js";
import type { SpecialistRunnerOptions } from "./options.js";
import { defaultWorkspaceRoot } from "./paths.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function parseComponents(value: unknown): ComponentRef[] {
  if (!Array.isArray(value)) return [];
  const out: ComponentRef[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const name = (item as { name?: unknown }).name;
    if (typeof name !== "string" || !name) continue;
    const version = (item as { version?: unknown }).version;
    const ecosystem = (item as { ecosystem?: unknown }).ecosystem;
    out.push({
      name,
      ...(typeof version === "string" ? { version } : {}),
      ...(typeof ecosystem === "string" ? { ecosystem } : {}),
    });
  }
  return out;
}

function detectAiWrittenFromRun(inv: AgentRunInvocation): boolean {
  const builders = inv.run.tasks.filter((t) => t.agentRole === "builder");
  for (const b of builders) {
    const out = b.output ?? {};
    if (Array.isArray(out.featuresIntroduced) && out.featuresIntroduced.length > 0) return true;
    const workItems = Array.isArray(out.workItems) ? out.workItems : [];
    if (
      workItems.some(
        (w) =>
          w &&
          typeof w === "object" &&
          (w as { kind?: string }).kind === "coding" &&
          ((w as { status?: string }).status === "completed" ||
            (w as { status?: string }).status === "dispatched"),
      )
    ) {
      return true;
    }
  }
  return asBoolean(inv.task.input?.aiWrittenCodeDetected) === true;
}

export function createSecurityRunner(options: SpecialistRunnerOptions = {}): AgentRunner {
  return async (inv: AgentRunInvocation): Promise<AgentRunResult> => {
    const workspaceRoot = options.workspaceRoot ?? defaultWorkspaceRoot();
    const input = inv.task.input ?? {};
    const repository =
      asString(input.repository) ?? inv.run.target.repository ?? "unknown/repo";
    const advisoryHints = asStringArray(input.advisoryHints);
    const aiComponentHints = asStringArray(input.aiComponentHints);

    const mocksUsed: MockMeta[] = [];
    const evidence: CreateEvidenceInput[] = [];

    let components = parseComponents(input.components);
    if (components.length === 0) {
      components = await discoverNpmComponents(workspaceRoot);
    }
    if (options.extraComponents?.length) {
      const seen = new Set(components.map((c) => c.name.toLowerCase()));
      for (const extra of options.extraComponents) {
        if (!seen.has(extra.name.toLowerCase())) components.push(extra);
      }
    }

    if (advisoryHints.length > 0) {
      throw new Error("Live advisory API is not configured.");
    }

    // MITRE ATLAS + OWASP LLM Top 10 hard guardrails for AI surfaces.
    const aiFindings = reviewAiSurfaceAgainstFrameworks({
      components,
      aiComponentHints,
      focusPaths: asStringArray(input.focusPaths),
      aiWrittenCodeDetected: detectAiWrittenFromRun(inv) || aiComponentHints.length > 0,
    }).map(enforceFrameworkHardFail);

    const frameworkMock = createMockMeta(
      "ai-security-frameworks",
      "MITRE ATLAS + OWASP LLM Top 10 applied as hard Security guardrails",
    );
    mocksUsed.push(frameworkMock);

    evidence.push({
      kind: "policy_ref",
      title: "MITRE ATLAS + OWASP LLM Top 10 review",
      summary:
        aiFindings.length === 0
          ? "No AI surface detected for ATLAS/OWASP hard-fail findings"
          : `${aiFindings.length} ATLAS/OWASP hard-fail finding(s) — Security check fails until resolved or human-waived`,
      source: "security",
      mock: frameworkMock,
      data: {
        frameworks: ["mitre_atlas", "owasp_llm_top_10"],
        hardFailCount: aiFindings.length,
        findingIds: aiFindings.map((f) => f.id),
      },
    });

    const findings = aiFindings.map(enforceFrameworkHardFail);

    for (const f of findings) {
      evidence.push({
        kind: f.frameworkMappings.length ? "finding" : "advisory",
        title: f.title,
        summary: f.summary,
        source: "security",
        mock: frameworkMock,
        data: {
          id: f.id,
          advisoryId: f.advisoryId,
          component: f.component,
          severity: f.severity,
          releaseBlocking: f.releaseBlocking,
          hardFail: f.hardFail,
          frameworkMappings: f.frameworkMappings,
        },
      });
    }

    const releaseBlockingCount = findings.filter((f) => f.releaseBlocking).length;
    const frameworkHardFailCount = findings.filter((f) => f.frameworkMappings.length > 0).length;
    const securityCheckFailed = frameworkHardFailCount > 0 || releaseBlockingCount > 0;
    const riskLevel = riskLevelFromFindings(findings);

    const grok = await grokComplete(
      `Security risk narrative for ${repository} using MITRE ATLAS and OWASP LLM Top 10. Findings: ${JSON.stringify(findings)}`,
      {
        ...options.grok,
        agentRole: options.grok?.agentRole ?? "security",
        safetySource: inv.runId,
      },
    );
    evidence.push({
      kind: "finding",
      title: "Grok security narrative",
      summary: grok.text.slice(0, 2000),
      source: "security",
    });

    const summary =
      findings.length === 0
        ? "Security check complete — no correlated advisories"
        : `Security check ${securityCheckFailed ? "FAILED" : "complete"} — ${findings.length} finding(s), ${releaseBlockingCount} release-blocking, ${frameworkHardFailCount} ATLAS/OWASP hard-fail(s), risk ${riskLevel}`;

    const payload = SecurityAgentOutputSchema.parse({
      runId: inv.runId,
      taskId: inv.taskId,
      agentRole: "security",
      status: "completed",
      completedAt: nowIso(),
      summary,
      evidence: [],
      mocksUsed,
      findings,
      releaseBlockingCount,
      riskLevel,
      frameworksApplied: ["mitre_atlas", "owasp_llm_top_10"],
      frameworkHardFailCount,
      securityCheckFailed,
    });

    return {
      status: "completed",
      summary: payload.summary,
      payload: {
        agentRole: payload.agentRole,
        findings: payload.findings,
        releaseBlockingCount: payload.releaseBlockingCount,
        riskLevel: payload.riskLevel,
        frameworksApplied: payload.frameworksApplied,
        frameworkHardFailCount: payload.frameworkHardFailCount,
        securityCheckFailed: payload.securityCheckFailed,
        evidence: payload.evidence,
        mocksUsed: payload.mocksUsed,
      },
      evidence,
      mocksUsed,
    };
  };
}
