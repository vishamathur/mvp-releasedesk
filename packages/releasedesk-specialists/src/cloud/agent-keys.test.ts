import { describe, expect, it } from "vitest";
import {
  CURSOR_API_KEY_ENV_BY_AGENT,
  describeAgentKeyResolution,
  listPerAgentCursorApiKeyEnvNames,
  NHI_SECRET_STORAGE,
  resolveCursorApiKeyForAgent,
  ZSCALER_PROVIDER_CREDENTIAL_ENV,
} from "./agent-keys.js";
import { resolveCloudAgentClient } from "./resolve.js";

describe("per-agent Cursor API keys (NHI)", () => {
  it("maps every Cloud Agent kind to a distinct env slot", () => {
    const names = listPerAgentCursorApiKeyEnvNames();
    expect(names).toContain("RELEASEDESK_CURSOR_API_KEY_LEAD");
    expect(names).toContain("RELEASEDESK_CURSOR_API_KEY_CHANGE_ANALYST");
    expect(names).toContain("RELEASEDESK_CURSOR_API_KEY_STANDARDS");
    expect(names).toContain("RELEASEDESK_CURSOR_API_KEY_SECURITY");
    expect(names).toContain("RELEASEDESK_CURSOR_API_KEY_BUILDER");
    expect(names).toContain("RELEASEDESK_CURSOR_API_KEY_AI_RED_TEAMING");
    expect(names).toContain("RELEASEDESK_CURSOR_API_KEY_CODING");
    expect(names).toContain("RELEASEDESK_CURSOR_API_KEY_TESTING");
    expect(names).toContain("RELEASEDESK_CURSOR_API_KEY_REVIEW");
    expect(new Set(names).size).toBe(names.length);
  });

  it("prefers per-agent key over legacy shared key", () => {
    const env = {
      RELEASEDESK_CURSOR_API_KEY_LEAD: "lead-key",
      CURSOR_API_KEY: "shared-key",
    };
    const lead = resolveCursorApiKeyForAgent("lead", env);
    expect(lead.present).toBe(true);
    expect(lead.apiKey).toBe("lead-key");
    expect(lead.usedLegacySharedFallback).toBe(false);
    expect(lead.envName).toBe(CURSOR_API_KEY_ENV_BY_AGENT.lead);

    const coding = resolveCursorApiKeyForAgent("coding", env);
    expect(coding.present).toBe(true);
    expect(coding.apiKey).toBe("shared-key");
    expect(coding.usedLegacySharedFallback).toBe(true);
    expect(describeAgentKeyResolution(coding)).toContain("legacy shared");
  });

  it("documents Zscaler provider credential placeholders", () => {
    expect(ZSCALER_PROVIDER_CREDENTIAL_ENV.primary).toBe(
      "RELEASEDESK_ZSCALER_AI_RED_TEAM_API_KEY",
    );
    expect(ZSCALER_PROVIDER_CREDENTIAL_ENV.legacy).toContain("ZSCALER_AI_RED_TEAM_API_KEY");
  });

  it("contracts Cursor named secrets storage (no external vault)", () => {
    expect(NHI_SECRET_STORAGE.externalVaultRequired).toBe(false);
    expect(NHI_SECRET_STORAGE.preferOidcOverLongLivedKeys).toBe(true);
    expect(NHI_SECRET_STORAGE.preferredSecretType).toBe("runtime_secret");
    expect(NHI_SECRET_STORAGE.primary).toBe("cursor_cloud_agent_environment_secrets");
    expect(NHI_SECRET_STORAGE.secondary).toBe("cursor_apps_dashboard_secrets");
  });

  it("stays MOCK by default even when per-agent keys exist", () => {
    const client = resolveCloudAgentClient({
      env: {
        RELEASEDESK_CURSOR_API_KEY_CODING: "c",
        RELEASEDESK_CURSOR_API_KEY_LEAD: "l",
      },
    });
    expect(client.mode).toBe("mock");
  });
});
