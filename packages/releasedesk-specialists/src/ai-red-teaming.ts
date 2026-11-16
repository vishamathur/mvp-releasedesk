import {
  AiRedTeamingAgentOutputSchema,
  AiRedTeamingFindingSchema,
  describeAiRedTeamingProvider,
  formatMockNote,
  nowIso,
  resolveAiRedTeamingProvider,
  type AiRedTeamFinding,
  type AiRedTeamFramework,
  type AiRedTeamProviderName,
  type AiRedTeamingFinding,
  type AiRedTeamingPassKind,
  type AiRedTeamingProvider,
  type AiRedTeamingTouchpoint,
  type CreateEvidenceInput,
  type MockMeta,
} from "@releasedesk/core";
import type { AgentRunner, AgentRunInvocation, AgentRunResult } from "@releasedesk/lead";
import { grokComplete } from "./grok.js";
import type { SpecialistRunnerOptions } from "./options.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function parseTouchpoint(value: unknown): AiRedTeamingTouchpoint {
  const allowed: AiRedTeamingTouchpoint[] = [
    "change_analyst",
    "standards",
    "security",
    "builder",
    "cloud_coding",
    "cloud_testing",
    "cloud_review",
    "post_builder",
    "sdlc_ai_prompt",
  ];
  if (typeof value === "string" && (allowed as string[]).includes(value)) {
    return value as AiRedTeamingTouchpoint;
  }
  return "sdlc_ai_prompt";
}

function parsePassKind(value: unknown): AiRedTeamingPassKind {
  if (value === "post_builder" || value === "hard_block" || value === "guardrail") {
    return value;
  }
  return "guardrail";
}

function parseInjectedFindings(value: unknown): AiRedTeamingFinding[] {
  if (!Array.isArray(value)) return [];
  const out: AiRedTeamingFinding[] = [];
  for (const item of value) {
    const parsed = AiRedTeamingFindingSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Map shared provider findings → specialist agent finding shape. */
function mapProviderFinding(
  f: AiRedTeamFinding,
  touchpoint: AiRedTeamingTouchpoint,
): AiRedTeamingFinding {
  const category: AiRedTeamingFinding["category"] = f.owasp.includes("LLM01")
    ? "prompt_injection"
    : f.owasp.includes("LLM02") || f.owasp.includes("LLM06")
      ? "data_leakage"
      : f.owasp.includes("LLM03")
        ? "model_poisoning"
        : f.owasp.includes("LLM04")
          ? "adversarial_attack"
          : "other";
  return {
    id: f.id,
    severity: f.severity,
    title: f.title,
    summary: f.summary,
    framework:
      f.atlas.length > 0 && f.owasp.length > 0
        ? "both"
        : f.atlas.length > 0
          ? "mitre_atlas"
          : "owasp_llm",
    ...(f.atlas[0] ? { atlasTechnique: f.atlas[0] } : {}),
    ...(f.owasp[0] ? { owaspLlmId: f.owasp[0] } : {}),
    category,
    releaseBlocking: f.releaseBlocking,
    touchpoint,
  };
}

/** Local subject-text heuristics (supplement provider probes; not a competing interface). */
const SUBJECT_HEURISTICS: Array<{
  pattern: RegExp;
  category: AiRedTeamingFinding["category"];
  title: string;
  atlasTechnique: string;
  owaspLlmId: string;
  severity: AiRedTeamingFinding["severity"];
  releaseBlocking: boolean;
}> = [
  {
    pattern: /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
    category: "prompt_injection",
    title: "Prompt injection — instruction override",
    atlasTechnique: "AML.T0051",
    owaspLlmId: "LLM01",
    severity: "high",
    releaseBlocking: true,
  },
  {
    pattern: /\b(?:sk-[a-zA-Z0-9]{20,}|api[_-]?key\s*[:=]\s*['\"][^'\"]{8,})/i,
    category: "data_leakage",
    title: "Secret-like material in AI subject text",
    atlasTechnique: "AML.T0024",
    owaspLlmId: "LLM06",
    severity: "critical",
    releaseBlocking: true,
  },
  {
    pattern: /poison(?:ed|ing)?\s+(?:training|dataset|model)/i,
    category: "model_poisoning",
    title: "Model / training-data poisoning indicator",
    atlasTechnique: "AML.T0010",
    owaspLlmId: "LLM03",
    severity: "high",
    releaseBlocking: true,
  },
];

function scanSubject(
  subjectText: string,
  touchpoint: AiRedTeamingTouchpoint,
): AiRedTeamingFinding[] {
  const findings: AiRedTeamingFinding[] = [];
  let seq = 0;
  for (const h of SUBJECT_HEURISTICS) {
    if (!h.pattern.test(subjectText)) continue;
    seq += 1;
    findings.push({
      id: `ai_rt_subject_${touchpoint}_${seq}`,
      severity: h.severity,
      title: h.title,
      summary: `Detected ${h.category.replace(/_/g, " ")} in subject @ ${touchpoint} (ATLAS ${h.atlasTechnique}, OWASP ${h.owaspLlmId}).`,
      framework: "both",
      atlasTechnique: h.atlasTechnique,
      owaspLlmId: h.owaspLlmId,
      category: h.category,
      releaseBlocking: h.releaseBlocking,
      touchpoint,
    });
  }
  return findings;
}

function riskLevelFromFindings(
  findings: AiRedTeamingFinding[],
): "none" | "low" | "medium" | "high" | "critical" {
  if (findings.some((f) => f.severity === "critical")) return "critical";
  if (findings.some((f) => f.severity === "high")) return "high";
  if (findings.some((f) => f.severity === "medium")) return "medium";
  if (findings.length > 0) return "low";
  return "none";
}

const DEFAULT_FRAMEWORKS: readonly AiRedTeamFramework[] = ["atlas", "owasp_llm_top_10"];

/**
 * AI Red Teaming specialist — uses shared `@releasedesk/core` `AiRedTeamingProvider`
 * (`runProbes` / `healthCheck`) from PR #14. Distinct from Security.
 */
export function createAiRedTeamingRunner(
  options: SpecialistRunnerOptions = {},
): AgentRunner {
  return async (inv: AgentRunInvocation): Promise<AgentRunResult> => {
    const input = inv.task.input ?? {};
    const repository =
      asString(input.repository) ?? inv.run.target.repository ?? "unknown/repo";
    const touchpoint = parseTouchpoint(input.touchpoint);
    const passKind = parsePassKind(input.passKind);
    const subjectText = asString(input.subjectText) ?? "";
    const subjectMeta =
      input.subjectMeta && typeof input.subjectMeta === "object"
        ? (input.subjectMeta as Record<string, unknown>)
        : {};
    const prDraft = asBoolean(subjectMeta.prDraft) === true;
    const reviewReady =
      asBoolean(subjectMeta.reviewReady) === true ||
      (asBoolean(subjectMeta.reviewReady) !== false && !prDraft && passKind === "hard_block");

    const provider: AiRedTeamingProvider = resolveAiRedTeamingProvider({
      ...(options.aiRedTeamingProvider ? { client: options.aiRedTeamingProvider } : {}),
      ...(options.aiRedTeamingProviderName
        ? { provider: options.aiRedTeamingProviderName }
        : {}),
    });

    const mocksUsed: MockMeta[] = [];
    const evidence: CreateEvidenceInput[] = [];

    let providerFindings: AiRedTeamingFinding[] = [];
    let providerName: AiRedTeamProviderName = provider.name;
    let providerSummary = describeAiRedTeamingProvider(provider);

    try {
      const health = await provider.healthCheck();
      evidence.push({
        kind: "log",
        title: "AI Red Teaming provider health",
        summary: health.message,
        source: "ai_red_teaming",
        data: { provider: health.provider, mode: health.mode, ok: health.ok },
      });

      // Skip noisy sample probes on clean guardrail passes unless subject/inject needs them,
      // or always run for post_builder / hard_block. For guardrails, prefer subject heuristics
      // + inject; still call provider when subject empty so custom/zscaler remain exercised
      // on dedicated passes.
      const shouldProbe =
        passKind === "post_builder" ||
        passKind === "hard_block" ||
        subjectText.length > 0 ||
        Boolean(input.forceProviderProbes);

      if (shouldProbe) {
        const probe = await provider.runProbes(
          {
            repository,
            appLabel: `releasedesk:${touchpoint}`,
            ...(typeof subjectMeta.promptId === "string"
              ? { sessionId: subjectMeta.promptId }
              : {}),
          },
          DEFAULT_FRAMEWORKS,
        );
        providerName = probe.provider;
        providerSummary = probe.summary;
        mocksUsed.push(...probe.mocksUsed);
        const treatProviderBlocking =
          probe.provider === "zscaler" || Boolean(input.treatProviderFindingsAsBlocking);
        providerFindings = probe.findings.map((f) => {
          const mapped = mapProviderFinding(f, touchpoint);
          // Custom sample probes are evidence for the shared contract; do not
          // auto hard-block every run unless explicitly requested.
          if (!treatProviderBlocking && probe.provider === "custom") {
            return { ...mapped, releaseBlocking: false };
          }
          return mapped;
        });
        for (const f of probe.findings) {
          evidence.push({
            kind: "finding",
            title: f.title,
            summary: f.summary,
            source: "ai_red_teaming",
            ...(f.mock ? { mock: f.mock } : {}),
            data: {
              id: f.id,
              provider: probe.provider,
              mode: probe.mode,
              atlas: f.atlas,
              owasp: f.owasp,
              releaseBlocking: f.releaseBlocking,
              touchpoint,
              passKind,
            },
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      evidence.push({
        kind: "log",
        title: "AI Red Teaming provider error",
        summary: formatMockNote(message),
        source: "ai_red_teaming",
        data: { provider: providerName, error: message },
      });
    }

    // Guardrail default: do not treat custom sample probes as blocking on every
    // specialist AI output — only subject heuristics + injectFindings + dedicated passes.
    const useProviderFindings = passKind !== "guardrail" || Boolean(input.forceProviderProbes);

    const findings: AiRedTeamingFinding[] = [
      ...(useProviderFindings ? providerFindings : []),
      ...scanSubject(subjectText, touchpoint),
      ...parseInjectedFindings(input.injectFindings).map((f) => ({
        ...f,
        touchpoint: f.touchpoint ?? touchpoint,
      })),
    ];

    // Deduplicate by id
    const seen = new Set<string>();
    const deduped = findings.filter((f) => {
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    });

    const releaseBlockingCount = deduped.filter((f) => f.releaseBlocking).length;
    const riskLevel = riskLevelFromFindings(deduped);
    const flagLeadRealtime =
      releaseBlockingCount > 0 || riskLevel === "high" || riskLevel === "critical";
    const hardBlockRecommended =
      passKind === "hard_block" && releaseBlockingCount > 0 && reviewReady && !prDraft;

    if (!options.skipGrok) {
      const grok = await grokComplete(
        `AI Red Teaming (${passKind}/${providerName}) for ${repository} @ ${touchpoint}. Findings: ${JSON.stringify(deduped)}`,
        {
          ...options.grok,
          fallback:
            deduped.length === 0
              ? "No ATLAS/OWASP LLM findings."
              : `${releaseBlockingCount} release-blocking AI Red Teaming finding(s); risk ${riskLevel}.`,
        },
      );
      if (grok.mocked && grok.mock) mocksUsed.push(grok.mock);
      if (!grok.mocked) {
        evidence.push({
          kind: "finding",
          title: "Grok AI Red Teaming narrative",
          summary: grok.text.slice(0, 2000),
          source: "ai_red_teaming",
        });
      }
    }

    const summary =
      deduped.length === 0
        ? formatMockNote(
            `AI Red Teaming ${passKind} @ ${touchpoint} (${providerName}) — no ATLAS/OWASP findings`,
          )
        : formatMockNote(
            `AI Red Teaming ${passKind} @ ${touchpoint} (${providerName}) — ${deduped.length} finding(s), ${releaseBlockingCount} release-blocking, risk ${riskLevel}${flagLeadRealtime ? "; flag Lead realtime" : ""}`,
          );

    const payload = AiRedTeamingAgentOutputSchema.parse({
      runId: inv.runId,
      taskId: inv.taskId,
      agentRole: "ai_red_teaming",
      status: "completed",
      completedAt: nowIso(),
      summary: `${summary} · ${providerSummary}`,
      evidence: [],
      mocksUsed,
      touchpoint,
      passKind,
      findings: deduped,
      releaseBlockingCount,
      riskLevel,
      frameworksApplied: ["mitre_atlas", "owasp_llm"],
      flagLeadRealtime,
      hardBlockRecommended,
    });

    return {
      status: "completed",
      summary: payload.summary,
      payload: {
        agentRole: payload.agentRole,
        touchpoint: payload.touchpoint,
        passKind: payload.passKind,
        findings: payload.findings,
        releaseBlockingCount: payload.releaseBlockingCount,
        riskLevel: payload.riskLevel,
        frameworksApplied: payload.frameworksApplied,
        flagLeadRealtime: payload.flagLeadRealtime,
        hardBlockRecommended: payload.hardBlockRecommended,
        providerName,
        evidence: payload.evidence,
        mocksUsed: payload.mocksUsed,
      },
      evidence,
      mocksUsed,
    };
  };
}
