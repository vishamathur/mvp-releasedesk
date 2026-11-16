import {
  mappingForAtlas,
  mappingForOwasp,
  type AtlasTechniqueId,
  type OwaspLlmTop10Id,
  type SecurityFinding,
  type SecurityFrameworkMapping,
} from "@releasedesk/core";
import type { ComponentRef } from "./advisories.js";

/** Path / package signals that the change touches AI-written code or AI components. */
const AI_PATH_PATTERNS: RegExp[] = [
  /(?:^|\/)(?:agents?|llm|prompt|grok|openai|anthropic|embeddings?|vector|rag)\b/i,
  /releasedesk-(?:specialists|lead|core)/i,
  /cloud[_-]?agent/i,
  /builder\.ts$/i,
  /security\.ts$/i,
  /ai-security/i,
];

const AI_PACKAGE_NAMES = new Set(
  [
    "openai",
    "@openai/openai",
    "anthropic",
    "@anthropic-ai/sdk",
    "grok",
    "@xai/grok",
    "langchain",
    "@langchain/core",
    "llamaindex",
    "evil-lib", // fixture AI-adjacent supply-chain demo
  ].map((n) => n.toLowerCase()),
);

export type AiReviewContext = {
  components: ComponentRef[];
  aiComponentHints?: string[];
  focusPaths?: string[];
  /** Builder / Cloud coding evidence that AI wrote code this run. */
  aiWrittenCodeDetected?: boolean;
};

export function isAiRelatedComponent(name: string): boolean {
  const lower = name.toLowerCase();
  if (AI_PACKAGE_NAMES.has(lower)) return true;
  return /(?:llm|openai|anthropic|grok|langchain|embed|vector)/i.test(lower);
}

export function isAiRelatedPath(path: string): boolean {
  return AI_PATH_PATTERNS.some((re) => re.test(path));
}

export function detectAiSurface(ctx: AiReviewContext): {
  aiComponents: ComponentRef[];
  aiPaths: string[];
  aiWrittenCodeDetected: boolean;
} {
  const hints = ctx.aiComponentHints ?? [];
  const paths = [...(ctx.focusPaths ?? []), ...hints].filter(Boolean);
  const aiPaths = paths.filter(isAiRelatedPath);
  const aiComponents = ctx.components.filter(
    (c) => isAiRelatedComponent(c.name) || hints.some((h) => h.toLowerCase() === c.name.toLowerCase()),
  );
  const aiWrittenCodeDetected =
    ctx.aiWrittenCodeDetected === true ||
    aiComponents.length > 0 ||
    aiPaths.length > 0 ||
    hints.length > 0;
  return { aiComponents, aiPaths, aiWrittenCodeDetected };
}

function mappings(
  owasp: OwaspLlmTop10Id[],
  atlas: AtlasTechniqueId[],
): SecurityFrameworkMapping[] {
  return [...owasp.map(mappingForOwasp), ...atlas.map(mappingForAtlas)];
}

/**
 * Produce hard-fail Security findings for AI surfaces using ATLAS + OWASP LLM Top 10.
 * Every mapped finding is release-blocking and hardFail=true.
 */
export function reviewAiSurfaceAgainstFrameworks(ctx: AiReviewContext): SecurityFinding[] {
  const surface = detectAiSurface(ctx);
  if (!surface.aiWrittenCodeDetected) return [];

  const findings: SecurityFinding[] = [];

  // Supply chain / model access — AI packages present
  if (surface.aiComponents.length > 0) {
    const names = surface.aiComponents.map((c) => c.name).join(", ");
    findings.push({
      id: "AI-FW-SUPPLY-CHAIN",
      severity: "high",
      title: "AI component supply-chain review required (OWASP LLM03 / ATLAS AML.T0010)",
      summary: `AI-related component(s) under review: ${names}. Treat as OWASP LLM Top 10 Supply Chain + MITRE ATLAS AI supply-chain compromise risk until verified.`,
      component: surface.aiComponents[0]?.name,
      releaseBlocking: true,
      hardFail: true,
      frameworkMappings: mappings(["LLM03"], ["AML.T0010"]),
    });
  }

  // Prompt injection / jailbreak — agent / prompt / LLM paths
  if (
    surface.aiPaths.some((p) => /prompt|agent|llm|grok/i.test(p)) ||
    surface.aiWrittenCodeDetected
  ) {
    findings.push({
      id: "AI-FW-PROMPT-INJECTION",
      severity: "high",
      title: "Prompt injection / LLM jailbreak controls required (OWASP LLM01 / ATLAS AML.T0051)",
      summary:
        "AI-written or agent/LLM code paths detected. Require input isolation, privilege separation, and jailbreak resistance per OWASP LLM01 and MITRE ATLAS AML.T0051/AML.T0054.",
      releaseBlocking: true,
      hardFail: true,
      frameworkMappings: mappings(["LLM01"], ["AML.T0051", "AML.T0054"]),
    });
  }

  // Excessive agency / improper output — Builder / Cloud Agents / specialists
  if (
    surface.aiWrittenCodeDetected ||
    surface.aiPaths.some((p) => /builder|cloud|specialist|orchestrator/i.test(p))
  ) {
    findings.push({
      id: "AI-FW-EXCESSIVE-AGENCY",
      severity: "high",
      title: "Excessive agency / improper output handling (OWASP LLM05/LLM06 / ATLAS AML.T0050)",
      summary:
        "AI coding agents can modify repos and open PRs. Enforce least privilege, human gates, and output validation per OWASP LLM05/LLM06 and ATLAS AML.T0050/AML.T0015.",
      releaseBlocking: true,
      hardFail: true,
      frameworkMappings: mappings(["LLM05", "LLM06"], ["AML.T0050", "AML.T0015"]),
    });
  }

  // Sensitive disclosure — always when AI surfaces present
  findings.push({
    id: "AI-FW-SENSITIVE-DISCLOSURE",
    severity: "medium",
    title: "Sensitive information disclosure controls (OWASP LLM02 / ATLAS AML.T0024)",
    summary:
      "AI components may exfiltrate secrets or PII via prompts/logs. Verify redaction and egress controls per OWASP LLM02 and ATLAS AML.T0024.",
    releaseBlocking: true,
    hardFail: true,
    frameworkMappings: mappings(["LLM02"], ["AML.T0024"]),
  });

  return findings;
}

/** Force hard-fail semantics on any finding that already carries framework mappings. */
export function enforceFrameworkHardFail(
  finding: SecurityFinding,
): SecurityFinding {
  if (!finding.frameworkMappings?.length) return finding;
  return {
    ...finding,
    hardFail: true,
    releaseBlocking: true,
    frameworkMappings: finding.frameworkMappings.map((m) => ({
      ...m,
      hardFail: true as const,
    })),
  };
}
