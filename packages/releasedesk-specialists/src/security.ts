import {
  createMockMeta,
  formatMockNote,
  nowIso,
  SecurityAgentOutputSchema,
  type CreateEvidenceInput,
  type MockMeta,
} from "@releasedesk/core";
import type { AgentRunner, AgentRunInvocation, AgentRunResult } from "@releasedesk/lead";
import {
  correlateAdvisories,
  loadAdvisoryCorpus,
  riskLevelFromFindings,
  type ComponentRef,
} from "./advisories.js";
import { discoverNpmComponents } from "./components.js";
import { grokComplete } from "./grok.js";
import type { SpecialistRunnerOptions } from "./options.js";
import { defaultWorkspaceRoot, sampleAdvisoriesPath } from "./paths.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
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

export function createSecurityRunner(options: SpecialistRunnerOptions = {}): AgentRunner {
  return async (inv: AgentRunInvocation): Promise<AgentRunResult> => {
    const workspaceRoot = options.workspaceRoot ?? defaultWorkspaceRoot();
    const input = inv.task.input ?? {};
    const repository =
      asString(input.repository) ?? inv.run.target.repository ?? "unknown/repo";
    const advisoryHints = asStringArray(input.advisoryHints);

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

    const advisoriesPath = options.advisoriesPath ?? sampleAdvisoriesPath();
    const corpus = await loadAdvisoryCorpus(advisoriesPath);

    // Live NVD/OSV not wired — fixture corpus is intentional MOCK for external advisory APIs.
    const advisoryMock = createMockMeta(
      "advisory-api",
      "NVD/OSV credentials unavailable; using in-repo sample advisory fixtures",
    );
    mocksUsed.push(advisoryMock);

    evidence.push({
      kind: "advisory",
      title: "Advisory corpus loaded",
      summary: formatMockNote(
        `Loaded ${corpus.advisories.length} sample advisory record(s) from fixtures`,
      ),
      source: "security",
      uri: advisoriesPath,
      mock: advisoryMock,
      data: { source: corpus.source, count: corpus.advisories.length },
    });

    const matched = correlateAdvisories(corpus.advisories, components, advisoryHints);

    const findings = matched.map((m) => ({
      id: m.id,
      severity: m.severity,
      title: m.title,
      summary: `${m.summary} Correlated to component ${m.matchedComponent.name}${
        m.matchedComponent.version ? `@${m.matchedComponent.version}` : ""
      }.`,
      component: m.matchedComponent.name,
      advisoryId: m.advisoryId,
      releaseBlocking: m.releaseBlocking,
    }));

    for (const f of findings) {
      evidence.push({
        kind: "advisory",
        title: f.title,
        summary: formatMockNote(f.summary),
        source: "security",
        mock: advisoryMock,
        data: {
          id: f.id,
          advisoryId: f.advisoryId,
          component: f.component,
          severity: f.severity,
          releaseBlocking: f.releaseBlocking,
        },
      });
    }

    const releaseBlockingCount = findings.filter((f) => f.releaseBlocking).length;
    const riskLevel = riskLevelFromFindings(findings);

    if (!options.skipGrok) {
      const grok = await grokComplete(
        `Security risk narrative for ${repository}. Findings: ${JSON.stringify(findings)}`,
        {
          ...options.grok,
          fallback:
            findings.length === 0
              ? "No correlated advisories in fixture scan."
              : `${releaseBlockingCount} release-blocking finding(s); risk ${riskLevel}.`,
        },
      );
      if (grok.mocked && grok.mock) mocksUsed.push(grok.mock);
      if (!grok.mocked) {
        evidence.push({
          kind: "finding",
          title: "Grok security narrative",
          summary: grok.text.slice(0, 2000),
          source: "security",
        });
      }
    }

    const summary =
      findings.length === 0
        ? formatMockNote("Security check complete — no correlated advisories (fixture corpus)")
        : formatMockNote(
            `Security check complete — ${findings.length} finding(s), ${releaseBlockingCount} release-blocking, risk ${riskLevel}`,
          );

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
    });

    return {
      status: "completed",
      summary: payload.summary,
      payload: {
        agentRole: payload.agentRole,
        findings: payload.findings,
        releaseBlockingCount: payload.releaseBlockingCount,
        riskLevel: payload.riskLevel,
        evidence: payload.evidence,
        mocksUsed: payload.mocksUsed,
      },
      evidence,
      mocksUsed,
    };
  };
}
