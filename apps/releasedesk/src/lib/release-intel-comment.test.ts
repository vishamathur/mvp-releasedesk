import { describe, expect, it } from "vitest";
import {
  matchReleaseIntelSha,
  parseReleaseIntelComment,
  renderReleaseIntelComment,
  sanitizeInline,
  toMachineReport,
} from "./release-intel-comment";
import type { ReleaseIntelPrReport } from "./release-intel-pr";

const SHA = "5bddf362221b88d9d52b829f5fb84b2cdc17577e";

function report(over: Partial<ReleaseIntelPrReport> = {}, summarize = "Adds a KYC field."): ReleaseIntelPrReport {
  return {
    heading: "release-intel v1",
    schema: "release-intel.v2",
    headSha: SHA,
    headShaSource: "env",
    generatedAt: "2026-11-26T05:00:00.000Z",
    filesTotal: 2,
    filesSent: 2,
    diffTruncated: false,
    diffTokenBudget: 32_000,
    diffTokensUsed: 120,
    apiPageCapHit: false,
    label: "LIVE",
    mode: "live",
    repository: "vishamathur/mvp-releasedesk",
    pullRequest: 41,
    title: "REQ-2026-0001: KYC field",
    changedPaths: ["apps/kyc/a.ts", "apps/kyc/b.ts"],
    intel: {
      mode: "live",
      label: "LIVE",
      keyPresent: true,
      model: "grok-4.3",
      requestedModel: "grok-4.3",
      modelReported: true,
      telemetry: {
        requestedModel: "grok-4.3",
        servedModel: "grok-4.3",
        promptTokens: 1234,
        completionTokens: 321,
        reasoningTokens: null,
        totalTokens: 1555,
        latencyMs: 4120,
        estUsd: 0.002345,
        estNote: "estimate from the public price table of 2026-11-26, not a bill",
        cachedPromptTokens: null,
        costInUsdTicks: null,
        billedCostUsd: null,
        billedNote: "billed cost not reported",
      },
      classify: { category: "security_review", confidence: 0.85 },
      extract: ["apps/kyc/a.ts"],
      score: { level: "high", rationale: "PII" },
      summarize,
      riskTier: "high",
      blockers: ["apps/kyc/a.ts:12"],
      groundedBlockers: [
        { path: "apps/kyc/a.ts", line: 12, evidence: "const token = stored", severity: "high" },
      ],
      droppedUngrounded: [
        { path: "B1", line: 1, evidence: "B1", severity: "high", reason: "path is not a changed file" },
      ],
      injectionSuspected: false,
      injectionReason: "",
      trustCheck: {
        schemaValid: true,
        humanGateStillRequired: true,
        noAutoApprove: true,
        keyEnvVar: "RELEASEDESK_GROK_API_KEY_LEAD",
        usedSharedFallback: false,
        notes: [],
      },
      mocked: false,
      rawPreview: "{raw}",
    },
    ...over,
  };
}

describe("renderReleaseIntelComment", () => {
  it("starts with the heading the workflow upserts on, and shows sha, risk and the footer line", () => {
    const body = renderReleaseIntelComment(report());
    expect(body.startsWith("## release-intel v1\n")).toBe(true);
    expect(body).toContain("`5bddf36`");
    expect(body).toContain(SHA);
    expect(body).toContain("**risk** high");
    expect(body).toContain("`apps/kyc/a.ts:12` (high)");
    expect(body).toContain("const token = stored");
    expect(body).toContain("**Dropped (ungrounded):**");
    expect(body).toContain("path is not a changed file");
    expect(body).toContain("**Prompt injection:** not suspected");
    expect(body).toContain("2/2 files sent");
    expect(body).toContain(
      "> grok-4.3 · 1234 prompt / 321 completion tokens · 4120 ms · billed cost not reported · est. cost $0.0023 (estimate, not a bill)",
    );
    expect(body).toMatch(/Grok never approves/);
  });

  it("round-trips the hidden machine block and drops the file list and raw preview from it", () => {
    const parsed = parseReleaseIntelComment(renderReleaseIntelComment(report()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.source).toBe("machine-block");
    expect(parsed.report.headSha).toBe(SHA);
    expect(parsed.report).not.toHaveProperty("changedPaths");
    const intel = parsed.report.intel as Record<string, unknown>;
    expect(intel).not.toHaveProperty("rawPreview");
    expect(intel.riskTier).toBe("high");
    expect(intel.blockers).toEqual(["apps/kyc/a.ts:12"]);
    expect((intel.blockers as string[]).join(",")).toBe("apps/kyc/a.ts:12");
    expect(parsed.report.schema).toBe("release-intel.v2");
    expect((intel.telemetry as Record<string, unknown>).promptTokens).toBe(1234);
    expect(toMachineReport(report())).not.toHaveProperty("changedPaths");
  });

  it("keeps a model-written --> or markup from closing the hidden block", () => {
    const evil = "ok --> <script>alert(1)</script> @octocat ```";
    const body = renderReleaseIntelComment(
      report({}, evil),
    );
    const parsed = parseReleaseIntelComment(body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect((parsed.report.intel as Record<string, unknown>).summarize).toBe(evil);
    const machine = body.slice(body.indexOf("<!-- release-intel-json:v1"), body.indexOf("\n-->"));
    expect(machine).not.toContain("<script>");
    expect(machine.slice(5)).not.toContain("-->");
    const visible = body.slice(0, body.indexOf("<!-- release-intel-json:v1"));
    expect(visible).not.toContain("<script>");
    expect(visible).not.toContain("@octocat");
  });

  it("says so when the head commit is unknown", () => {
    const body = renderReleaseIntelComment(report({ headSha: null, headShaSource: "unavailable" }));
    expect(body).toContain("**Commit** unknown");
    const parsed = parseReleaseIntelComment(body);
    expect(parsed.ok && parsed.report.headSha).toBeNull();
  });

  it("shows plainly that usage was not reported", () => {
    const r = report();
    r.intel.telemetry = {
      ...r.intel.telemetry,
      servedModel: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      estUsd: null,
      estNote: "usage not reported by the API",
    };
    const body = renderReleaseIntelComment(r);
    expect(body).toContain("response did not report a model");
    expect(body).toContain("token usage not reported");
    expect(body).toContain("billed cost not reported");
    expect(body).toContain("est. cost n/a");
  });

  it("never contains the API key", () => {
    expect(renderReleaseIntelComment(report())).not.toMatch(/Bearer|sk-|xai-/);
  });
});

describe("parseReleaseIntelComment", () => {
  it("still parses a v1 comment whose blockers are strings", () => {
    const legacy = [
      "## release-intel v1",
      "",
      "<!-- release-intel-json:v1",
      JSON.stringify({ schema: "release-intel.v1", headSha: SHA, intel: { blockers: ["B1"], riskTier: "high" } }),
      "-->",
    ].join("\n");
    const parsed = parseReleaseIntelComment(legacy);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const blockers = (parsed.report.intel as { blockers: string[] }).blockers;
    expect(blockers.join(",")).toBe("B1");
  });

  it("reads a comment written before the machine block existed (first json fence)", () => {
    const legacy = `## release-intel v1\n\n\`\`\`json\n${JSON.stringify({ intel: { riskTier: "high" } })}\n\`\`\``;
    const parsed = parseReleaseIntelComment(legacy);
    expect(parsed.ok && parsed.source).toBe("json-fence");
    expect(parsed.ok && parsed.report.headSha).toBeUndefined();
  });

  it("rejects other comments and broken blocks", () => {
    expect(parseReleaseIntelComment("looks good").ok).toBe(false);
    expect(parseReleaseIntelComment("## release-intel v1\n<!-- release-intel-json:v1\n{bad\n-->").ok).toBe(false);
    expect(parseReleaseIntelComment("## release-intel v1\n<!-- release-intel-json:v1\n{}").ok).toBe(false);
    expect(parseReleaseIntelComment("## release-intel v1\nnothing else").ok).toBe(false);
  });
});

describe("matchReleaseIntelSha", () => {
  it("matches, mismatches, and refuses to verify a report with no sha", () => {
    expect(matchReleaseIntelSha({ headSha: SHA }, SHA.toUpperCase())).toEqual({ status: "match" });
    expect(matchReleaseIntelSha({ headSha: SHA }, "4160579fee57448d37564fd92ca1321fafbac962")).toMatchObject({
      status: "mismatch",
    });
    expect(matchReleaseIntelSha({}, SHA)).toMatchObject({ status: "unverifiable" });
    expect(matchReleaseIntelSha({ headSha: null }, SHA)).toMatchObject({ status: "unverifiable" });
    expect(matchReleaseIntelSha({ headSha: SHA }, "")).toMatchObject({ status: "unverifiable" });
  });
});

describe("sanitizeInline", () => {
  it("flattens whitespace, removes backticks and live mentions, and caps length", () => {
    expect(sanitizeInline("a\n\nb `c` @d <e>")).toBe("a b 'c' @\u200bd &lt;e>");
    expect(sanitizeInline("x".repeat(500), 50).length).toBe(50);
  });
});
