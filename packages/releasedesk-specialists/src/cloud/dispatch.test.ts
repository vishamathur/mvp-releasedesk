import { describe, expect, it } from "vitest";
import { MissingCredentialError } from "@releasedesk/core";
import { createRealCloudAgentClient } from "./real-client.js";
import { resolveCloudAgentClient } from "./resolve.js";

describe("resolveCloudAgentClient", () => {
  it("throws when exclusive Cursor keys are missing and ignores shared keys", () => {
    expect(() =>
      resolveCloudAgentClient({
        env: { CURSOR_API_KEY: "shared-must-not-use" },
      }),
    ).toThrow(MissingCredentialError);
  });

  it("returns the real client when every exclusive key is set", () => {
    const client = resolveCloudAgentClient({
      env: {
        RELEASEDESK_CURSOR_API_KEY_CODING: "coding-exclusive",
        RELEASEDESK_CURSOR_API_KEY_TESTING: "testing-exclusive",
        RELEASEDESK_CURSOR_API_KEY_REVIEW: "review-exclusive",
        CURSOR_API_KEY: "shared-ignored",
      },
    });
    expect(client.mode).toBe("real");
  });

  it("throws for the kind whose exclusive key is missing", async () => {
    const client = createRealCloudAgentClient({
      resolveApiKeyForKind: (kind) => (kind === "coding" ? "coding-exclusive" : undefined),
      fetchImpl: (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch,
    });

    await expect(
      client.dispatch({
        handoffId: "t1",
        agentKind: "testing",
        prompt: "verify",
        repository: "owner/repo",
        baseBranch: "main",
        proposedBranch: "cursor/x",
        acceptanceCriteria: [],
        autoMerge: false,
      }),
    ).rejects.toBeInstanceOf(MissingCredentialError);
  });
});
