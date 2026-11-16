import { describe, expect, it } from "vitest";
import {
  CURSOR_API_KEY_ENV,
  FORBIDDEN_SHARED_KEY_ENV,
  GROK_API_KEY_ENV,
  describeAgentCursorCredential,
  describeAgentGrokCredential,
  listAgentCredentialStatuses,
  listRequiredAgentApiKeyEnvVars,
  resolveAgentCursorApiKey,
  resolveAgentGrokApiKey,
  type CursorKeyedAgentId,
  type GrokKeyedAgentRole,
} from "./agent-credentials.js";

const GROK_ROLES = Object.keys(GROK_API_KEY_ENV) as GrokKeyedAgentRole[];
const CURSOR_IDS = Object.keys(CURSOR_API_KEY_ENV) as CursorKeyedAgentId[];

describe("agent-credentials — exclusive keys only", () => {
  it("maps every Grok role to a distinct RELEASEDESK_GROK_API_KEY_* env var", () => {
    const vars = Object.values(GROK_API_KEY_ENV);
    expect(vars).toEqual([
      "RELEASEDESK_GROK_API_KEY_LEAD",
      "RELEASEDESK_GROK_API_KEY_CHANGE_ANALYST",
      "RELEASEDESK_GROK_API_KEY_STANDARDS",
      "RELEASEDESK_GROK_API_KEY_SECURITY",
      "RELEASEDESK_GROK_API_KEY_BUILDER",
    ]);
    expect(new Set(vars).size).toBe(vars.length);
  });

  it("maps every Cursor agent to a distinct RELEASEDESK_CURSOR_API_KEY_* env var", () => {
    const vars = Object.values(CURSOR_API_KEY_ENV);
    expect(vars).toEqual([
      "RELEASEDESK_CURSOR_API_KEY_LEAD",
      "RELEASEDESK_CURSOR_API_KEY_BUILDER",
      "RELEASEDESK_CURSOR_API_KEY_CODING",
      "RELEASEDESK_CURSOR_API_KEY_TESTING",
      "RELEASEDESK_CURSOR_API_KEY_REVIEW",
    ]);
    expect(new Set(vars).size).toBe(vars.length);
  });

  it("never overlaps Grok and Cursor exclusive env var names", () => {
    const all = listRequiredAgentApiKeyEnvVars();
    expect(new Set(all).size).toBe(all.length);
    expect(all.every((v) => v.startsWith("RELEASEDESK_"))).toBe(true);
  });

  it("lists forbidden shared keys that must never be consulted", () => {
    expect([...FORBIDDEN_SHARED_KEY_ENV]).toEqual([
      "XAI_API_KEY",
      "GROK_API_KEY",
      "CURSOR_API_KEY",
      "CURSOR_SERVICE_ACCOUNT_KEY",
    ]);
  });

  it("resolveAgentGrokApiKey reads only that agent's exclusive env var", () => {
    const env: NodeJS.ProcessEnv = {
      RELEASEDESK_GROK_API_KEY_SECURITY: "sec-key-only",
      XAI_API_KEY: "shared-xai",
      GROK_API_KEY: "shared-grok",
      RELEASEDESK_GROK_API_KEY_LEAD: "lead-key",
    };
    expect(resolveAgentGrokApiKey("security", env)).toBe("sec-key-only");
    expect(resolveAgentGrokApiKey("lead", env)).toBe("lead-key");
    expect(resolveAgentGrokApiKey("standards", env)).toBeUndefined();
    expect(resolveAgentGrokApiKey("change_analyst", env)).toBeUndefined();
    expect(resolveAgentGrokApiKey("builder", env)).toBeUndefined();
  });

  it("resolveAgentGrokApiKey ignores shared XAI_API_KEY / GROK_API_KEY entirely", () => {
    const env: NodeJS.ProcessEnv = {
      XAI_API_KEY: "must-not-use",
      GROK_API_KEY: "must-not-use-either",
    };
    for (const role of GROK_ROLES) {
      expect(resolveAgentGrokApiKey(role, env)).toBeUndefined();
      const status = describeAgentGrokCredential(role, env);
      expect(status.present).toBe(false);
      expect(status.usedSharedFallback).toBe(false);
      expect(status.envVar).toBe(GROK_API_KEY_ENV[role]);
    }
  });

  it("resolveAgentCursorApiKey reads only that agent's exclusive env var", () => {
    const env: NodeJS.ProcessEnv = {
      RELEASEDESK_CURSOR_API_KEY_CODING: "coding-key",
      CURSOR_API_KEY: "shared-cursor",
      CURSOR_SERVICE_ACCOUNT_KEY: "shared-sa",
      RELEASEDESK_CURSOR_API_KEY_REVIEW: "review-key",
    };
    expect(resolveAgentCursorApiKey("coding", env)).toBe("coding-key");
    expect(resolveAgentCursorApiKey("review", env)).toBe("review-key");
    expect(resolveAgentCursorApiKey("lead", env)).toBeUndefined();
    expect(resolveAgentCursorApiKey("builder", env)).toBeUndefined();
    expect(resolveAgentCursorApiKey("testing", env)).toBeUndefined();
  });

  it("resolveAgentCursorApiKey ignores shared CURSOR_API_KEY / CURSOR_SERVICE_ACCOUNT_KEY", () => {
    const env: NodeJS.ProcessEnv = {
      CURSOR_API_KEY: "must-not-use",
      CURSOR_SERVICE_ACCOUNT_KEY: "must-not-use-either",
    };
    for (const id of CURSOR_IDS) {
      expect(resolveAgentCursorApiKey(id, env)).toBeUndefined();
      const status = describeAgentCursorCredential(id, env);
      expect(status.present).toBe(false);
      expect(status.usedSharedFallback).toBe(false);
      expect(status.envVar).toBe(CURSOR_API_KEY_ENV[id]);
    }
  });

  it("does not cross-wire one agent's exclusive key to another agent", () => {
    const env: NodeJS.ProcessEnv = {
      RELEASEDESK_GROK_API_KEY_LEAD: "lead-only",
      RELEASEDESK_CURSOR_API_KEY_LEAD: "cursor-lead-only",
    };
    expect(resolveAgentGrokApiKey("builder", env)).toBeUndefined();
    expect(resolveAgentCursorApiKey("builder", env)).toBeUndefined();
    expect(resolveAgentGrokApiKey("lead", env)).toBe("lead-only");
    expect(resolveAgentCursorApiKey("lead", env)).toBe("cursor-lead-only");
  });

  it("listAgentCredentialStatuses covers every exclusive slot and never claims shared fallback", () => {
    const env: NodeJS.ProcessEnv = {
      RELEASEDESK_GROK_API_KEY_STANDARDS: "std",
      RELEASEDESK_CURSOR_API_KEY_TESTING: "test-key",
      XAI_API_KEY: "shared",
      GROK_API_KEY: "shared",
      CURSOR_API_KEY: "shared",
    };
    const statuses = listAgentCredentialStatuses(env);
    expect(statuses).toHaveLength(GROK_ROLES.length + CURSOR_IDS.length);
    expect(statuses.every((s) => s.usedSharedFallback === false)).toBe(true);
    expect(statuses.find((s) => s.agentId === "standards")?.present).toBe(true);
    expect(statuses.find((s) => s.agentId === "testing")?.present).toBe(true);
    expect(statuses.find((s) => s.agentId === "security")?.present).toBe(false);
  });
});
