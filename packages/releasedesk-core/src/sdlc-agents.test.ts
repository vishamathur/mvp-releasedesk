import { describe, expect, it } from "vitest";
import {
  CURSOR_API_KEY_ENV,
  FORBIDDEN_SHARED_KEY_ENV,
  GROK_API_KEY_ENV,
  listRequiredAgentApiKeyEnvVars,
} from "./agent-credentials.js";
import {
  SDLC_AGENT_DEFINITIONS,
  SDLC_BUILDER_AGENT,
  SDLC_CHANGE_ANALYST_AGENT,
  SDLC_CODING_AGENT,
  SDLC_LEAD_AGENT,
  SDLC_REVIEW_AGENT,
  SDLC_SECURITY_AGENT,
  SDLC_STANDARDS_AGENT,
  SDLC_TESTING_AGENT,
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

  it("wires exclusive apiKeyEnv on every definition", () => {
    expect(SDLC_LEAD_AGENT.apiKeyEnv).toEqual([
      GROK_API_KEY_ENV.lead,
      CURSOR_API_KEY_ENV.lead,
    ]);
    expect(SDLC_CHANGE_ANALYST_AGENT.apiKeyEnv).toEqual([
      GROK_API_KEY_ENV.change_analyst,
    ]);
    expect(SDLC_STANDARDS_AGENT.apiKeyEnv).toEqual([GROK_API_KEY_ENV.standards]);
    expect(SDLC_SECURITY_AGENT.apiKeyEnv).toEqual([GROK_API_KEY_ENV.security]);
    expect(SDLC_BUILDER_AGENT.apiKeyEnv).toEqual([
      GROK_API_KEY_ENV.builder,
      CURSOR_API_KEY_ENV.builder,
    ]);
    expect(SDLC_CODING_AGENT.apiKeyEnv).toEqual([CURSOR_API_KEY_ENV.coding]);
    expect(SDLC_TESTING_AGENT.apiKeyEnv).toEqual([CURSOR_API_KEY_ENV.testing]);
    expect(SDLC_REVIEW_AGENT.apiKeyEnv).toEqual([CURSOR_API_KEY_ENV.review]);
  });

  it("never lists forbidden shared keys on any agent definition", () => {
    const forbidden = new Set<string>(FORBIDDEN_SHARED_KEY_ENV);
    for (const def of SDLC_AGENT_DEFINITIONS) {
      for (const envVar of def.apiKeyEnv) {
        expect(forbidden.has(envVar)).toBe(false);
        expect(envVar.startsWith("RELEASEDESK_")).toBe(true);
      }
    }
  });

  it("assertExclusiveApiKeys passes for the default catalog", () => {
    expect(() => assertExclusiveApiKeys()).not.toThrow();
    expect(() => assertExclusiveApiKeys(SDLC_AGENT_DEFINITIONS)).not.toThrow();
  });

  it("assertExclusiveApiKeys throws when two agents claim the same env var", () => {
    expect(() =>
      assertExclusiveApiKeys([
        { ...SDLC_SECURITY_AGENT, apiKeyEnv: ["RELEASEDESK_GROK_API_KEY_SECURITY"] },
        {
          ...SDLC_STANDARDS_AGENT,
          apiKeyEnv: ["RELEASEDESK_GROK_API_KEY_SECURITY"],
        },
      ]),
    ).toThrow(/Shared API key env/);
  });

  it("catalog apiKeyEnv union covers every required exclusive env var", () => {
    const claimed = new Set(
      SDLC_AGENT_DEFINITIONS.flatMap((d) => d.apiKeyEnv),
    );
    for (const envVar of listRequiredAgentApiKeyEnvVars()) {
      expect(claimed.has(envVar)).toBe(true);
    }
  });

  it("getSdlcAgentDefinition looks up by id", () => {
    expect(getSdlcAgentDefinition("lead")?.label).toBe(SDLC_LEAD_AGENT.label);
    expect(getSdlcAgentDefinition("missing")).toBeUndefined();
  });

  it("Lead and Builder declare hybrid runtimes and delegates", () => {
    expect(SDLC_LEAD_AGENT.runtime).toBe("hybrid");
    expect(SDLC_LEAD_AGENT.delegatesTo).toEqual([
      "change_analyst",
      "standards",
      "security",
      "builder",
    ]);
    expect(SDLC_BUILDER_AGENT.runtime).toBe("hybrid");
    expect(SDLC_BUILDER_AGENT.delegatesTo).toEqual([
      "coding",
      "testing",
      "review",
    ]);
  });
});
