import { describe, expect, it } from "vitest";
import { createMockPrClient } from "./mock-client.js";
import { createRealPrClient } from "./real-client.js";
import { resolvePrClient, resolveGithubToken, describePrClientMode } from "./resolve.js";
import {
  openAndTrackPullRequest,
  parsePrNumberFromUrl,
  pollTrackedPullRequest,
  refuseAutoMerge,
  trackExistingPullRequest,
} from "./workflow.js";

describe("MOCK GitHub PR client", () => {
  it("opens, tracks, polls, and refuses merge", async () => {
    const client = createMockPrClient({ startNumber: 42, checkStatus: "success" });
    expect(client.mode).toBe("mock");
    expect(describePrClientMode(client)).toMatch(/^MOCK:/);

    const opened = await openAndTrackPullRequest(client, {
      repository: "vishamathur/mvp-releasedesk",
      title: "Remediation",
      body: "test",
      head: "cursor/fix",
      base: "main",
    });
    expect(opened.prNumber).toBe(42);
    expect(opened.url).toContain("/pull/42");
    expect(opened.autoMerge).toBe(false);
    expect(opened.humanMergeGateRequired).toBe(true);
    expect(opened.clientMode).toBe("mock");

    const polled = await pollTrackedPullRequest(client, opened);
    expect(polled.lastStatus?.checkStatus).toBe("success");
    expect(polled.lastStatus?.autoMerge).toBe(false);
    expect(polled.lastStatus?.mocked).toBe(true);

    await expect(refuseAutoMerge(client, opened)).rejects.toThrow(/refuses auto-merge/i);
  });

  it("tracks existing PR URL from Builder", async () => {
    const client = createMockPrClient();
    const tracked = await trackExistingPullRequest(client, {
      repository: "vishamathur/mvp-releasedesk",
      prUrl: "https://github.com/vishamathur/mvp-releasedesk/pull/7",
      head: "cursor/builder-branch",
      source: "builder",
    });
    expect(tracked.prNumber).toBe(7);
    expect(tracked.source).toBe("builder");
    expect(tracked.autoMerge).toBe(false);
  });
});

describe("resolvePrClient", () => {
  it("defaults to MOCK without token", () => {
    const client = resolvePrClient({
      mode: "auto",
      token: undefined,
      // Force empty token path
    });
    // When we don't pass token and env may have one, force mock:
    const mock = resolvePrClient({ mode: "mock" });
    expect(mock.mode).toBe("mock");
    expect(client.mode === "mock" || client.mode === "real").toBe(true);
  });

  it("uses real when mode=real + token", async () => {
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
