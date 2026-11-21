import { describe, expect, it } from "vitest";
import { listRequiredAgentApiKeyEnvVars } from "./agent-credentials.js";
import {
  SDLC_AGENT_DEFINITIONS,
  SDLC_BUILDER_AGENT,
  SDLC_LEAD_AGENT,
  SDLC_SECURITY_AGENT,
  assertExclusiveApiKeys,
  getSdlcAgentDefinition,
} from "./sdlc-agents.js";

describe("sdlc-agents catalog", () => {
  it("includes Lead + specialists + nested Cloud Agents", () => {
    const ids = SDLC_AGENT_DEFINITIONS.map((a) => a.id);
    expect(ids).toEqual([
      "lead",
      "change_analyst",
      "standards",
      "security",
      "builder",
      "coding",
      "testing",
      "review",
    ]);
  });

  it("marks Security as mandatory on every change", () => {
    expect(SDLC_SECURITY_AGENT.mandatoryOnEveryChange).toBe(true);
    expect(SDLC_SECURITY_AGENT.requirements).toContain("security");
    expect(SDLC_SECURITY_AGENT.runtime).toBe("grok_bot");
  });

  it("gives no bot a per-bot API key", () => {
    for (const def of SDLC_AGENT_DEFINITIONS) {
      expect(def.apiKeyEnv).toEqual([]);
    }
    expect(listRequiredAgentApiKeyEnvVars()).toEqual(["XAI_API_KEY"]);
  });

  it("assertExclusiveApiKeys passes for the default catalog", () => {
    expect(() => assertExclusiveApiKeys()).not.toThrow();
  });

  it("assertExclusiveApiKeys throws when a definition claims a key", () => {
    expect(() =>
      assertExclusiveApiKeys([
        { ...SDLC_SECURITY_AGENT, apiKeyEnv: ["RELEASEDESK_GROK_API_KEY_SECURITY"] },
      ]),
    ).toThrow(/per-bot keys are retired/);
  });

  it("getSdlcAgentDefinition looks up by id", () => {
    expect(getSdlcAgentDefinition("lead")?.label).toBe(SDLC_LEAD_AGENT.label);
    expect(getSdlcAgentDefinition("missing")).toBeUndefined();
  });

  it("Lead and Builder declare runtimes and delegates", () => {
    expect(SDLC_LEAD_AGENT.runtime).toBe("hybrid");
    expect(SDLC_LEAD_AGENT.delegatesTo).toEqual([
      "change_analyst",
      "standards",
      "security",
      "builder",
    ]);
    expect(SDLC_BUILDER_AGENT.runtime).toBe("hybrid");
    expect(SDLC_BUILDER_AGENT.delegatesTo).toEqual(["coding", "testing", "review"]);
  });
});
