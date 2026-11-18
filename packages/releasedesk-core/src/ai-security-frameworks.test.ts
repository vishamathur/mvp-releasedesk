import { describe, expect, it } from "vitest";
import {
  assertAiFrameworkPrMergeAllowed,
  createAiFrameworkWaiver,
  evaluateAiFrameworkMergeGate,
  listUnresolvedFrameworkFindings,
  mappingForAtlas,
  mappingForOwasp,
  OWASP_LLM_TOP_10,
  ATLAS_TECHNIQUES,
} from "./ai-security-frameworks.js";

const mappedFinding = {
  id: "AI-FW-PROMPT-INJECTION",
  hardFail: true,
  releaseBlocking: true,
  frameworkMappings: [mappingForOwasp("LLM01"), mappingForAtlas("AML.T0051")],
};

describe("ATLAS / OWASP LLM Top 10 hard guardrails", () => {
  it("exposes OWASP LLM Top 10 and ATLAS technique catalogs", () => {
    expect(OWASP_LLM_TOP_10).toHaveLength(10);
    expect(ATLAS_TECHNIQUES.length).toBeGreaterThan(0);
    expect(mappingForOwasp("LLM03").hardFail).toBe(true);
    expect(mappingForAtlas("AML.T0010").framework).toBe("mitre_atlas");
  });

  it("treats mapped findings as unresolved until human-waived", () => {
    const unresolved = listUnresolvedFrameworkFindings([mappedFinding], { waivers: [] });
    expect(unresolved).toHaveLength(1);

    const waiver = createAiFrameworkWaiver({
      findingId: mappedFinding.id,
      waivedBy: "security-reviewer",
      reason: "Accepted residual risk with compensating controls",
      frameworks: ["mitre_atlas", "owasp_llm_top_10"],
    });
    expect(
      listUnresolvedFrameworkFindings([mappedFinding], { waivers: [waiver] }),
    ).toHaveLength(0);
  });

  it("blocks PR merge for open-for-review PRs with unresolved findings", () => {
    const gate = evaluateAiFrameworkMergeGate({
      findings: [mappedFinding],
      prDraft: false,
      prState: "open",
    });
    expect(gate.blocksPrMerge).toBe(true);
    expect(gate.draftExempt).toBe(false);
    expect(() => assertAiFrameworkPrMergeAllowed(gate)).toThrow(/block PR merge/i);
  });

  it("does not block merge for draft PRs (Security still has unresolved findings)", () => {
    const gate = evaluateAiFrameworkMergeGate({
      findings: [mappedFinding],
      prDraft: true,
      prState: "open",
    });
    expect(gate.hasUnresolvedFindings).toBe(true);
    expect(gate.blocksPrMerge).toBe(false);
    expect(gate.draftExempt).toBe(true);
    expect(() => assertAiFrameworkPrMergeAllowed(gate)).not.toThrow();
  });
});
