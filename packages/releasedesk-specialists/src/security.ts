import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  bindChild,
  createMockMeta,
  delegateToChildren,
  findChildResult,
  formatMockNote,
  nowIso,
  SecurityAgentOutputSchema,
  type CreateEvidenceInput,
  type MockMeta,
  type SecurityFinding,
  type SubAgentAggregate,
} from "@releasedesk/core";
import type { AgentRunner, AgentRunInvocation, AgentRunResult } from "@releasedesk/lead";
import {
  correlateAdvisories,
  loadAdvisoryCorpus,
  riskLevelFromFindings,
  type ComponentRef,
} from "./advisories.js";
import {
  enforceFrameworkHardFail,
  reviewAiSurfaceAgainstFrameworks,
} from "./ai-framework-review.js";
import { discoverNpmComponents } from "./components.js";
import { grokComplete } from "./grok.js";
import type { SpecialistRunnerOptions } from "./options.js";
import { defaultWorkspaceRoot, sampleAdvisoriesPath } from "./paths.js";
import { failedSubAgentResult, subAgentHooks } from "./sub-agent-hooks.js";

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

const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
  /api[_-]?key\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i,
  /AKIA[0-9A-Z]{16}/,
];

const PROMPT_BYPASS_PATTERNS: readonly RegExp[] = [
  /ignore (all|any|previous) (instructions|security)/i,
  /skip (the )?(security|red[_ -]?team) (review|gate|check)/i,
  /waive (the )?security/i,
  /auto-?approve (merge|release|security)/i,
  /disable (the )?(iteration|security) gate/i,
];

function patternHit(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

async function secretScanText(workspaceRoot: string, inputText: string): Promise<string> {
  const probes = [
    "apps/kyc/src/lib/domain/risk.ts",
    "apps/kyc/README.md",
    "README.md",
  ];
  let blob = inputText;
  for (const rel of probes) {
    try {
      const text = await readFile(path.join(workspaceRoot, rel), "utf8");
      blob += `\n${text.slice(0, 20_000)}`;
    } catch {
      // optional probe
    }
  }
  return blob;
}

function asFindingArray(value: unknown): SecurityFinding[] {
  if (!Array.isArray(value)) return [];
  const out: SecurityFinding[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const finding = item as SecurityFinding;
    if (typeof finding.id !== "string" || typeof finding.title !== "string") continue;
    if (typeof finding.summary !== "string" || typeof finding.severity !== "string") continue;
    out.push(finding);
  }
  return out;
}

function failClosedFinding(aggregate: SubAgentAggregate): SecurityFinding {
  const broken = [...aggregate.failedIds, ...aggregate.timedOutIds, ...aggregate.skippedIds];
  return {
    id: "security-sub-agent-fail-closed",
    severity: "high",
    title: "Security sub-agent failed closed",
    summary: `A required security slice did not finish (${broken.join(", ") || "unknown"}). The security check fails closed and does not approve the iteration gate.`,
    releaseBlocking: true,
    hardFail: true,
    frameworkMappings: [],
  };
}

type SecurityContext = {
  inv: AgentRunInvocation;
  options: SpecialistRunnerOptions;
  workspaceRoot: string;
  repository: string;
  components: ComponentRef[];
  advisoryHints: string[];
  aiComponentHints: string[];
  focusPaths: string[];
  aiWrittenCodeDetected: boolean;
};

export function createSecurityRunner(options: SpecialistRunnerOptions = {}): AgentRunner {
  const hooks = subAgentHooks<SecurityContext>(options.subAgents);
  return async (inv: AgentRunInvocation): Promise<AgentRunResult> => {
    const workspaceRoot = options.workspaceRoot ?? defaultWorkspaceRoot();
    const input = inv.task.input ?? {};
    const repository = asString(input.repository) ?? inv.run.target.repository ?? "unknown/repo";
    const advisoryHints = asStringArray(input.advisoryHints);
    const aiComponentHints = asStringArray(input.aiComponentHints);
    const focusPaths = asStringArray(input.focusPaths);

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

    const context: SecurityContext = {
      inv,
      options,
      workspaceRoot,
      repository,
      components,
      advisoryHints,
      aiComponentHints,
      focusPaths,
      aiWrittenCodeDetected: detectAiWrittenFromRun(inv) || aiComponentHints.length > 0,
    };

    const aggregate = await delegateToChildren({
      parentId: "security",
      context,
      children: [
        bindChild(
          "security",
          "security.secret-scan",
          async (ctx) => {
            const text = await secretScanText(ctx.workspaceRoot, JSON.stringify(ctx.inv.task.input ?? {}));
            const hit = patternHit(text, SECRET_PATTERNS);
            const findings: SecurityFinding[] = hit
              ? [
                  {
                    id: "secret-scan-hit",
                    severity: "critical",
                    title: "Possible secret in change input",
                    summary:
                      "A private-key or hardcoded credential pattern matched. The matched value was not recorded.",
                    releaseBlocking: true,
                    hardFail: true,
                    frameworkMappings: [],
                  },
                ]
              : [];
            return {
              summary: hit
                ? "Secret scan found a credential-like pattern"
                : "Secret scan found no credential-like pattern",
              payload: { findings, hits: findings.length },
            };
          },
          hooks,
        ),
        bindChild(
          "security",
          "security.dependency-cve",
          async (ctx) => {
            const advisoriesPath = ctx.options.advisoriesPath ?? sampleAdvisoriesPath();
            const corpus = await loadAdvisoryCorpus(advisoriesPath);
            const matched = correlateAdvisories(corpus.advisories, ctx.components, ctx.advisoryHints);
            const findings: SecurityFinding[] = matched.map((m) =>
              enforceFrameworkHardFail({
                id: m.id,
                severity: m.severity,
                title: m.title,
                summary: `${m.summary} Correlated to component ${m.matchedComponent.name}${
                  m.matchedComponent.version ? `@${m.matchedComponent.version}` : ""
                }.`,
                component: m.matchedComponent.name,
                advisoryId: m.advisoryId,
                releaseBlocking: m.releaseBlocking,
                hardFail: m.releaseBlocking,
                frameworkMappings: [],
              }),
            );
            return {
              summary: `Correlated ${findings.length} advisory finding(s) from ${corpus.advisories.length} fixture record(s)`,
              payload: {
                findings,
                corpusCount: corpus.advisories.length,
                corpusSource: corpus.source,
                advisoriesPath,
              },
            };
          },
          hooks,
        ),
        bindChild(
          "security",
          "security.red-team-prompts",
          async (ctx) => {
            const frameworkFindings = reviewAiSurfaceAgainstFrameworks({
              components: ctx.components,
              aiComponentHints: ctx.aiComponentHints,
              focusPaths: ctx.focusPaths,
              aiWrittenCodeDetected: ctx.aiWrittenCodeDetected,
            }).map(enforceFrameworkHardFail);
            const promptText = JSON.stringify(ctx.inv.task.input ?? {});
            const promptFindings: SecurityFinding[] = patternHit(promptText, PROMPT_BYPASS_PATTERNS)
              ? [
                  enforceFrameworkHardFail({
                    id: "red-team-prompt-bypass",
                    severity: "high",
                    title: "Prompt asks to bypass security or the iteration gate",
                    summary:
                      "Change input asked to skip, waive, or auto-approve a security or iteration gate. The request was refused.",
                    releaseBlocking: true,
                    hardFail: true,
                    frameworkMappings: [],
                  }),
                ]
              : [];
            return {
              summary:
                frameworkFindings.length + promptFindings.length === 0
                  ? "Red-team prompt check found no bypass"
                  : `Red-team prompt check recorded ${frameworkFindings.length + promptFindings.length} finding(s)`,
              payload: { frameworkFindings, promptFindings },
            };
          },
          hooks,
        ),
      ],
    });

    const mocksUsed: MockMeta[] = [];
    const evidence: CreateEvidenceInput[] = [];

    const cve = findChildResult(aggregate, "security.dependency-cve");
    const redTeam = findChildResult(aggregate, "security.red-team-prompts");
    const secrets = findChildResult(aggregate, "security.secret-scan");

    const advisoryFindings = asFindingArray(cve?.payload.findings);
    const aiFindings = asFindingArray(redTeam?.payload.frameworkFindings);
    const promptFindings = asFindingArray(redTeam?.payload.promptFindings);
    const secretFindings = asFindingArray(secrets?.payload.findings);

    const corpusCount = typeof cve?.payload.corpusCount === "number" ? cve.payload.corpusCount : 0;
    const corpusSource = typeof cve?.payload.corpusSource === "string" ? cve.payload.corpusSource : "fixture";
    const advisoriesPath =
      typeof cve?.payload.advisoriesPath === "string"
        ? cve.payload.advisoriesPath
        : (options.advisoriesPath ?? sampleAdvisoriesPath());

    if (cve?.status === "completed") {
      const advisoryMock = createMockMeta(
        "advisory-api",
        "NVD/OSV credentials unavailable; using in-repo sample advisory fixtures",
      );
      mocksUsed.push(advisoryMock);
      evidence.push({
        kind: "advisory",
        title: "Advisory corpus loaded",
        summary: formatMockNote(
          `Loaded ${corpusCount} sample advisory record(s) from fixtures`,
        ),
        source: "security",
        uri: advisoriesPath,
        mock: advisoryMock,
        data: { source: corpusSource, count: corpusCount },
      });
    }

    const frameworkMock = createMockMeta(
      "ai-security-frameworks",
      "MITRE ATLAS + OWASP LLM Top 10 applied as hard Security guardrails",
    );
    mocksUsed.push(frameworkMock);
    evidence.push({
      kind: "policy_ref",
      title: "MITRE ATLAS + OWASP LLM Top 10 review",
      summary: formatMockNote(
        aiFindings.length === 0
          ? "No AI surface detected for ATLAS/OWASP hard-fail findings"
          : `${aiFindings.length} ATLAS/OWASP hard-fail finding(s) — Security check fails until resolved or human-waived`,
      ),
      source: "security",
      mock: frameworkMock,
      data: {
        frameworks: ["mitre_atlas", "owasp_llm_top_10"],
        hardFailCount: aiFindings.length,
        findingIds: aiFindings.map((f) => f.id),
      },
    });

    let findings = [...advisoryFindings, ...aiFindings, ...secretFindings, ...promptFindings].map(
      enforceFrameworkHardFail,
    );
    if (aggregate.securityGateHeld) {
      findings = [...findings, failClosedFinding(aggregate)];
    }

    const advisoryMock = mocksUsed.find((mock) => mock.mockLabel === "advisory-api");
    for (const f of findings) {
      evidence.push({
        kind: f.frameworkMappings.length ? "finding" : "advisory",
        title: f.title,
        summary: formatMockNote(f.summary),
        source: "security",
        mock: f.frameworkMappings.length ? frameworkMock : advisoryMock,
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
    const securityCheckFailed =
      aggregate.securityGateHeld || frameworkHardFailCount > 0 || releaseBlockingCount > 0;
    const riskLevel = riskLevelFromFindings(findings);

    if (!options.skipGrok) {
      const grok = await grokComplete(
        `Security risk narrative for ${repository} using MITRE ATLAS and OWASP LLM Top 10. Findings: ${JSON.stringify(findings)}`,
        {
          ...options.grok,
          agentRole: options.grok?.agentRole ?? "security",
          fallback:
            findings.length === 0
              ? "No correlated advisories or ATLAS/OWASP findings."
              : `${releaseBlockingCount} release-blocking; ${frameworkHardFailCount} ATLAS/OWASP hard-fail(s); risk ${riskLevel}.`,
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

    const summary = aggregate.securityGateHeld
      ? formatMockNote(
          `Security check FAILED closed — ${findings.length} finding(s), ${releaseBlockingCount} release-blocking, risk ${riskLevel}`,
        )
      : findings.length === 0
        ? formatMockNote("Security check complete — no correlated advisories (fixture corpus)")
        : formatMockNote(
            `Security check ${securityCheckFailed ? "FAILED" : "complete"} — ${findings.length} finding(s), ${releaseBlockingCount} release-blocking, ${frameworkHardFailCount} ATLAS/OWASP hard-fail(s), risk ${riskLevel}`,
          );

    const payload = SecurityAgentOutputSchema.parse({
      runId: inv.runId,
      taskId: inv.taskId,
      agentRole: "security",
      status: aggregate.securityGateHeld ? "failed" : "completed",
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

    const resultPayload = {
      agentRole: payload.agentRole,
      findings: payload.findings,
      releaseBlockingCount: payload.releaseBlockingCount,
      riskLevel: payload.riskLevel,
      frameworksApplied: payload.frameworksApplied,
      frameworkHardFailCount: payload.frameworkHardFailCount,
      securityCheckFailed: payload.securityCheckFailed,
      evidence: payload.evidence,
      mocksUsed: payload.mocksUsed,
      subAgents: aggregate,
    };

    if (aggregate.securityGateHeld) {
      const failed = failedSubAgentResult("security", aggregate, resultPayload);
      return {
        ...failed,
        summary: payload.summary,
        payload: resultPayload,
        evidence,
        mocksUsed,
      };
    }

    return {
      status: "completed",
      summary: payload.summary,
      payload: resultPayload,
      evidence,
      mocksUsed,
    };
  };
}
