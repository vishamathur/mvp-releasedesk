import { describe, expect, it } from "vitest";
import {
  APP_GROK_API_KEY_ENV,
  CURSOR_API_KEY_ENV,
  GROK_API_KEY_ENV,
  RETIRED_KEY_ENV,
  describeAgentCursorCredential,
  describeAgentGrokCredential,
  describeAppGrokCredential,
  listAgentCredentialStatuses,
  listRequiredAgentApiKeyEnvVars,
  resolveAgentCursorApiKey,
  resolveAgentGrokApiKey,
  resolveAppGrokApiKey,
  type CursorKeyedAgentId,
  type GrokKeyedAgentRole,
} from "./agent-credentials.js";

const GROK_ROLES = Object.keys(GROK_API_KEY_ENV) as GrokKeyedAgentRole[];
const CURSOR_IDS = Object.keys(CURSOR_API_KEY_ENV) as CursorKeyedAgentId[];

describe("agent-credentials — one app key", () => {
  it("reads only XAI_API_KEY for the shipped Grok call", () => {
    expect(APP_GROK_API_KEY_ENV).toBe("XAI_API_KEY");
    expect(listRequiredAgentApiKeyEnvVars()).toEqual(["XAI_API_KEY"]);
    expect(resolveAppGrokApiKey({ XAI_API_KEY: "app-key" })).toBe("app-key");
    expect(
      resolveAppGrokApiKey({
        GROK_API_KEY: "alias-ignored",
        RELEASEDESK_GROK_API_KEY_LEAD: "per-bot-ignored",
      }),
    ).toBeUndefined();
  });

  it("does not let a per-bot key satisfy the app key", () => {
    const env: NodeJS.ProcessEnv = {
      RELEASEDESK_GROK_API_KEY_LEAD: "lead-only",
      RELEASEDESK_GROK_API_KEY_SECURITY: "sec-only",
      XAI_API_KEY: "app-key",
    };
    expect(resolveAppGrokApiKey(env)).toBe("app-key");
    for (const role of GROK_ROLES) {
      expect(resolveAgentGrokApiKey(role, env)).toBeUndefined();
    }
  });

  it("retired per-bot resolvers stay empty", () => {
    const env: NodeJS.ProcessEnv = {
      RELEASEDESK_CURSOR_API_KEY_CODING: "coding-key",
      CURSOR_API_KEY: "shared",
      XAI_API_KEY: "app-key",
    };
    for (const id of CURSOR_IDS) {
      expect(resolveAgentCursorApiKey(id, env)).toBeUndefined();
      expect(describeAgentCursorCredential(id, env).present).toBe(false);
    }
    expect(describeAgentGrokCredential("security", env).present).toBe(true);
    expect(describeAgentGrokCredential("security", env).envVar).toBe("XAI_API_KEY");
    expect(describeAgentGrokCredential("security", env).usedSharedFallback).toBe(false);
  });

  it("lists retired names and never echoes secret values from status", () => {
    expect(RETIRED_KEY_ENV).toContain("RELEASEDESK_GROK_API_KEY_LEAD");
    expect(RETIRED_KEY_ENV).toContain("RELEASEDESK_CURSOR_API_KEY_CODING");
    expect(RETIRED_KEY_ENV).not.toContain("XAI_API_KEY");
    const statuses = listAgentCredentialStatuses({ XAI_API_KEY: "secret-value" });
    expect(statuses).toEqual([
      {
        agentId: "app",
        envVar: "XAI_API_KEY",
        present: true,
        usedSharedFallback: false,
      },
    ]);
    expect(JSON.stringify(statuses)).not.toContain("secret-value");
    expect(describeAppGrokCredential({}).present).toBe(false);
  });
});
