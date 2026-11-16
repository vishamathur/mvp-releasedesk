import { describe, expect, it } from "vitest";
import {
  describeCloudClientMode,
  resolveCloudAgentClient,
  resolveCloudAgentClientForKind,
} from "./resolve.js";
import { resolveCursorApiKeyForAgent } from "./real-client.js";

describe("resolveCursorApiKeyForAgent (exclusive keys)", () => {
  it("reads only RELEASEDESK_CURSOR_API_KEY_* for the given kind", () => {
    const env = {
      RELEASEDESK_CURSOR_API_KEY_CODING: "coding-key",
      RELEASEDESK_CURSOR_API_KEY_TESTING: "testing-key",
      CURSOR_API_KEY: "shared-must-not-win",
      CURSOR_SERVICE_ACCOUNT_KEY: "also-shared",
    };
    expect(resolveCursorApiKeyForAgent("coding", env)).toBe("coding-key");
    expect(resolveCursorApiKeyForAgent("testing", env)).toBe("testing-key");
    expect(resolveCursorApiKeyForAgent("review", env)).toBeUndefined();
  });

  it("coding key present does not unlock testing", () => {
    const env = {
      RELEASEDESK_CURSOR_API_KEY_CODING: "only-coding",
      RELEASEDESK_CLOUD_CLIENT: "real",
      CURSOR_API_KEY: "shared",
    };
    const coding = resolveCloudAgentClientForKind("coding", { env, mode: "real" });
    const testing = resolveCloudAgentClientForKind("testing", { env, mode: "real" });
    expect(coding.mode).toBe("real");
    expect(testing.mode).toBe("real");
  });
});

describe("resolveCloudAgentClientForKind", () => {
  it("defaults to MOCK without RELEASEDESK_CLOUD_CLIENT=real", () => {
    const client = resolveCloudAgentClientForKind("coding", {
      env: { RELEASEDESK_CURSOR_API_KEY_CODING: "k" },
    });
    expect(client.mode).toBe("mock");
  });

  it("shared CURSOR_API_KEY alone does not enable real for SDLC path", async () => {
    const client = resolveCloudAgentClientForKind("coding", {
      mode: "real",
      env: { CURSOR_API_KEY: "shared-only", RELEASEDESK_CLOUD_CLIENT: "real" },
    });
    expect(client.mode).toBe("real");
    const result = await client.dispatch({
      handoffId: "h1",
      agentKind: "coding",
      prompt: "x",
      repository: "owner/repo",
      baseBranch: "main",
      proposedBranch: "cursor/x",
      acceptanceCriteria: [],
      autoMerge: false,
    });
    expect(result.status).toBe("failed");
    expect(result.mocked).toBe(true);
    expect(result.error).toMatch(/RELEASEDESK_CURSOR_API_KEY_CODING/);
  });

  it("enables real when exclusive kind key + RELEASEDESK_CLOUD_CLIENT=real", () => {
    const client = resolveCloudAgentClientForKind("review", {
      mode: "real",
      env: {
        RELEASEDESK_CURSOR_API_KEY_REVIEW: "review-key",
        RELEASEDESK_CLOUD_CLIENT: "real",
      },
    });
    expect(client.mode).toBe("real");
  });

  it("coding key does not enable real testing client", async () => {
    const env = {
      RELEASEDESK_CURSOR_API_KEY_CODING: "coding-only",
      RELEASEDESK_CLOUD_CLIENT: "real",
    };
    const testing = resolveCloudAgentClientForKind("testing", { env, mode: "real" });
    const result = await testing.dispatch({
      handoffId: "h-test",
      agentKind: "testing",
      prompt: "verify",
      repository: "owner/repo",
      baseBranch: "main",
      proposedBranch: "cursor/x",
      acceptanceCriteria: [],
      autoMerge: false,
    });
    expect(result.status).toBe("failed");
    expect(result.mocked).toBe(true);
    expect(result.error).toMatch(/RELEASEDESK_CURSOR_API_KEY_TESTING/);
  });
});

describe("resolveCloudAgentClient (kindless SDLC-safe)", () => {
  it("ignores shared CURSOR_API_KEY even when real requested", async () => {
    const client = resolveCloudAgentClient({
      mode: "real",
      env: { CURSOR_API_KEY: "shared", RELEASEDESK_CLOUD_CLIENT: "real" },
    });
    expect(client.mode).toBe("real");
    const result = await client.dispatch({
      handoffId: "h",
      agentKind: "coding",
      prompt: "x",
      repository: "owner/repo",
      baseBranch: "main",
      proposedBranch: "cursor/x",
      acceptanceCriteria: [],
      autoMerge: false,
    });
    expect(result.mocked).toBe(true);
    expect(result.status).toBe("failed");
  });
});

describe("describeCloudClientMode", () => {
  it("mentions exclusive per-agent env for real clients", () => {
    const client = resolveCloudAgentClientForKind("coding", {
      mode: "real",
      env: { RELEASEDESK_CURSOR_API_KEY_CODING: "k" },
    });
    const text = describeCloudClientMode(client, "coding");
    expect(text).toContain("RELEASEDESK_CURSOR_API_KEY_CODING");
    expect(text).toMatch(/shared CURSOR_API_KEY unused/i);
  });
});
