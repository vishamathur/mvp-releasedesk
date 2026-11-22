import { describe, expect, it } from "vitest";
import { MissingCredentialError } from "@releasedesk/core";
import { createRealPrClient } from "./real-client.js";
import { resolvePrClient, resolveGithubToken } from "./resolve.js";
import { parsePrNumberFromUrl } from "./workflow.js";

describe("resolvePrClient", () => {
  it("throws when no token is configured", () => {
    expect(() => resolvePrClient({ token: undefined })).toThrow(MissingCredentialError);
  });

  it("uses the real client when a token is passed", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      return new Response(
        JSON.stringify({
          number: 99,
          html_url: "https://github.com/vishamathur/mvp-releasedesk/pull/99",
          title: "Real PR",
          body: "body",
          head: { ref: "feat", sha: "abc123" },
          base: { ref: "main" },
          state: "open",
          draft: false,
          merged: false,
          mergeable: true,
          created_at: "2026-11-14T00:00:00.000Z",
          updated_at: "2026-11-14T00:00:00.000Z",
          labels: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const client = createRealPrClient({
      token: "test-token",
      fetchImpl,
      apiBase: "https://api.github.com",
    });
    expect(client.mode).toBe("real");

    const pr = await client.openPullRequest({
      repository: "vishamathur/mvp-releasedesk",
      title: "Real PR",
      body: "body",
      head: "feat",
      base: "main",
    });
    expect(pr.number).toBe(99);
    expect(pr.autoMerge).toBe(false);
    expect(calls[0]).toContain("/repos/vishamathur/mvp-releasedesk/pulls");

    await expect(client.mergePullRequest("vishamathur/mvp-releasedesk", 99)).rejects.toThrow(
      /refuses auto-merge/i,
    );
  });

  it("resolveGithubToken prefers GH_TOKEN then GITHUB_TOKEN", () => {
    expect(resolveGithubToken({ GH_TOKEN: "a", GITHUB_TOKEN: "b" })).toBe("a");
    expect(resolveGithubToken({ GITHUB_TOKEN: "b" })).toBe("b");
    expect(resolveGithubToken({})).toBeUndefined();
  });
});

describe("parsePrNumberFromUrl", () => {
  it("extracts PR numbers", () => {
    expect(parsePrNumberFromUrl("https://github.com/o/r/pull/12")).toBe(12);
    expect(parsePrNumberFromUrl("https://github.com/o/r/pull/12/files")).toBe(12);
    expect(parsePrNumberFromUrl("not-a-url")).toBeUndefined();
  });
});
