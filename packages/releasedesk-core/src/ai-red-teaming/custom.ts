import { createMockMeta, formatMockNote } from "../mock.js";
import type {
  AiRedTeamFinding,
  AiRedTeamFramework,
  AiRedTeamHealthCheck,
  AiRedTeamProbeResult,
  AiRedTeamProbeTarget,
  AiRedTeamingProvider,
} from "./types.js";

function filterByFrameworks(
  findings: AiRedTeamFinding[],
  frameworks: readonly AiRedTeamFramework[],
): AiRedTeamFinding[] {
  if (frameworks.length === 0) return findings;
  const wantAtlas = frameworks.includes("atlas");
  const wantOwasp = frameworks.includes("owasp_llm_top_10");
  return findings.filter((f) => {
    if (wantAtlas && f.atlas.length > 0) return true;
    if (wantOwasp && f.owasp.length > 0) return true;
    return false;
  });
}

/**
 * Default / custom AI Red Teaming provider.
 * Offline sample probes so Lead can call the same contract without Zscaler.
 * Full custom agent runtime may wrap this; findings are MOCK-labeled until a
 * live custom probe engine is attached.
 */
export function createCustomAiRedTeamingProvider(): AiRedTeamingProvider {
  const mock = createMockMeta(
    "ai-red-team-custom",
    "Custom AI Red Teaming provider using in-repo sample probes (no external vendor)",
  );

  return {
    name: "custom",

    async healthCheck(): Promise<AiRedTeamHealthCheck> {
      return {
        provider: "custom",
        ok: true,
        mode: "mock",
        message: formatMockNote(
          "Custom AI Red Teaming provider ready (sample probes; no live model required)",
        ),
      };
    },

    async runProbes(
      target: AiRedTeamProbeTarget,
      frameworks: readonly AiRedTeamFramework[],
    ): Promise<AiRedTeamProbeResult> {
      const app = target.appLabel ?? target.repository ?? target.endpoint ?? "unknown-target";
      const findings: AiRedTeamFinding[] = [
        {
          id: "custom-sample-prompt-injection",
          severity: "high",
          title: "Prompt injection susceptibility (sample)",
          summary: formatMockNote(
            `Custom probe flagged possible prompt injection on ${app}`,
          ),
          atlas: ["AML.T0051"],
          owasp: ["LLM01"],
          releaseBlocking: true,
          mocked: true,
          mock,
        },
        {
          id: "custom-sample-sensitive-leak",
          severity: "medium",
          title: "Sensitive data leakage (sample)",
          summary: formatMockNote(
            `Custom probe flagged possible sensitive context leakage on ${app}`,
          ),
          atlas: ["AML.T0055"],
          owasp: ["LLM02"],
          releaseBlocking: true,
          mocked: true,
          mock,
        },
      ];

      const filtered = filterByFrameworks(findings, frameworks);

      return {
        provider: "custom",
        mode: "mock",
        findings: filtered,
        summary: formatMockNote(
          `Custom AI Red Teaming returned ${filtered.length} sample finding(s) for ${app}`,
        ),
        mocksUsed: [mock],
      };
    },
  };
}
