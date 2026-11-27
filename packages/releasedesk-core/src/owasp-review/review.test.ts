import { describe, expect, it } from "vitest";
import { hashSafetyIdentifier } from "../grok-guardrails.js";
import type { GrokTelemetry } from "../grok-telemetry.js";
import { OWASP_CONTROL_IDS } from "./catalogue.js";
import { renderOwaspReviewComment, parseOwaspReviewComment } from "./comment.js";
import { addedPatch } from "./diff.js";
import { NOT_SELECTED_REASON, selectControls } from "./select.js";
import {
  OWASP_CONFIDENCE_MIN,
  OWASP_REVIEW_BATCH_SIZE,
  OWASP_REVIEW_KEY_ENV_LEAD,
  OWASP_REVIEW_KEY_ENV_SECURITY,
  OWASP_REVIEW_MAX_TOKENS,
  PASS_STATIC_REASON,
  UNGROUNDED_REASON,
  reviewDiff,
  runOwaspReview,
  type ModelCallResult,
} from "./review.js";
import type { DiffFile, OwaspReviewInput } from "./types.js";

const TELEMETRY: GrokTelemetry = {
  requestedModel: "grok-4.3",
  servedModel: "grok-4.3",
  promptTokens: 12,
  completionTokens: 8,
  reasoningTokens: null,
  totalTokens: 20,
  cachedPromptTokens: null,
  costInUsdTicks: null,
  latencyMs: 15,
  estUsd: 0,
  estNote: "estimate from the public price table, not a bill",
  billedCostUsd: null,
  billedNote: "billed cost not reported",
};

const LEAD_KEY = "lead-owasp-test-key";
const SECURITY_KEY = "security-owasp-test-key";

function file(path: string, lines: readonly string[]): DiffFile {
  return { path, patch: addedPatch(lines) };
}

function reviewInput(files: DiffFile[], extra: Partial<OwaspReviewInput> = {}): OwaspReviewInput {
  return {
    repository: "vishamathur/mvp-releasedesk",
    pullRequest: 7,
    headSha: "abc1234def",
    title: "sample change",
    files,
    generatedAt: "2026-11-27T00:00:00.000Z",
    ...extra,
  };
}

type ModelControl = {
  id: string;
  verdict: "PASS" | "FAIL" | "NOT_APPLICABLE" | "UNDECIDED";
  confidence: number;
  path: string;
  line: number;
  evidence: string;
  severity: "low" | "medium" | "high" | "critical" | "none";
  autoFixable: boolean;
  suggestedFix: { what: string; where: string; why: string; owaspId: string };
};

function modelOf(files: DiffFile[], edit: (control: ModelControl) => ModelControl = (control) => control): ModelCallResult {
  const controls = selectControls(files)
    .controls.filter((control) => control.selected)
    .map((control) =>
      edit({
        id: control.id,
        verdict: "PASS",
        confidence: 0.9,
        path: "",
        line: 0,
        evidence: "",
        severity: "none",
        autoFixable: true,
        suggestedFix: { what: "", where: "", why: "", owaspId: control.id },
      }),
    );
  return {
    ok: true,
    payload: { controls },
    requestedModel: "grok-4.3",
    servedModel: "grok-4.3",
    telemetry: TELEMETRY,
  };
}

const clean = [file("src/format.ts", ["export const n = 1;"])];

function secretLine(): string {
  const value = ["AK", "IA", "TESTSECRETKEY12"].join("");
  return `const apiKey = "${value}";`;
}

describe("reviewDiff", () => {
  it("auto-proceeds when every selected control passes and the rest are not selected", () => {
    const report = reviewDiff(reviewInput(clean), modelOf(clean), OWASP_REVIEW_KEY_ENV_LEAD);
    expect(report.status).toBe("completed");
    expect(report.outcome).toBe("auto-proceed");
    expect(report.risk).toBe("assessed");
    expect(report.failures).toEqual([]);
    expect(report.exceptions).toEqual([]);
    expect(report.humanGateStillRequired).toBe(true);
    expect(report.noAutoApprove).toBe(true);
    expect(report.advisory).toBe(true);
    expect(report.controls.map((control) => control.id)).toEqual([...OWASP_CONTROL_IDS]);
    const floor = report.controls.find((control) => control.id === "X01");
    expect(floor).toMatchObject({
      verdict: "PASS",
      selected: true,
      rules: ["secrets-floor"],
      paths: ["src/format.ts"],
    });
    for (const control of report.controls.filter((item) => !item.selected)) {
      expect(control.verdict).toBe("NOT_APPLICABLE");
      expect(control.reason).toBe(NOT_SELECTED_REASON);
      expect(control.rules).toEqual([]);
      expect(control.paths).toEqual([]);
    }
    const comment = renderOwaspReviewComment(report);
    expect(comment.startsWith("## owasp-review v1")).toBe(true);
    expect(comment).not.toContain(LEAD_KEY);
    const parsed = parseOwaspReviewComment(comment);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.report.outcome).toBe("auto-proceed");
  });

  it("keeps a grounded FAIL and the concrete fix for Builder", () => {
    const line = secretLine();
    const files = [file("src/config.ts", [line])];
    const report = reviewDiff(
      reviewInput(files),
      modelOf(files, (control) =>
        control.id === "X01"
          ? {
              ...control,
              verdict: "FAIL",
              confidence: 0.93,
              path: "src/config.ts",
              line: 1,
              evidence: line,
              severity: "high",
              autoFixable: true,
              suggestedFix: {
                what: "model wording",
                where: "src/config.ts:1",
                why: "model why",
                owaspId: "X01",
              },
            }
          : control,
      ),
      OWASP_REVIEW_KEY_ENV_SECURITY,
    );
    expect(report.outcome).toBe("remediate");
    expect(report.exceptions).toEqual([]);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toMatchObject({
      id: "X01",
      path: "src/config.ts",
      line: 1,
      severity: "high",
      evidence: line,
      autoFixable: true,
    });
    expect(report.failures[0]?.suggestedFix).toEqual({
      what: "Remove the hard-coded credential and read it from the environment or a secret store.",
      where: "src/config.ts:1",
      why: "A credential in source can be copied from repository history.",
      owaspId: "X01",
    });
    expect(report.failureRounds).toEqual({ X01: 1 });
    expect(report.controls.find((control) => control.id === "X01")?.verdict).toBe("FAIL");
    expect(report.controls.find((control) => control.id === "X01")?.rules).toEqual(["secrets-floor"]);
  });

  it("drops an ungrounded FAIL and does not record it as a pass", () => {
    const report = reviewDiff(
      reviewInput(clean),
      modelOf(clean, (control) =>
        control.id === "X01"
          ? {
              ...control,
              verdict: "FAIL",
              confidence: 0.91,
              path: "not/real.ts",
              line: 1,
              evidence: "const apiKey = not-in-the-diff",
              severity: "high",
            }
          : control,
      ),
      OWASP_REVIEW_KEY_ENV_LEAD,
    );
    expect(report.outcome).toBe("auto-proceed");
    expect(report.failures).toEqual([]);
    expect(report.droppedUngrounded.map((item) => item.reason)).toEqual(["path is not a changed file"]);
    const floor = report.controls.find((control) => control.id === "X01");
    expect(floor?.verdict).toBe("NOT_APPLICABLE");
    expect(floor?.verdict).not.toBe("PASS");
    expect(floor?.reason).toBe(UNGROUNDED_REASON);
  });

  it("escalates AMBIGUOUS when the model conflicts with a deterministic finding", () => {
    const line = secretLine();
    const files = [file("src/config.ts", [line])];
    const report = reviewDiff(
      reviewInput(files),
      modelOf(files, (control) => (control.id === "X01" ? { ...control, verdict: "PASS", confidence: 0.95 } : control)),
      OWASP_REVIEW_KEY_ENV_LEAD,
    );
    expect(report.outcome).toBe("needs-human");
    expect(report.outcome).not.toBe("auto-proceed");
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.suggestedFix.owaspId).toBe("X01");
    expect(report.exceptions.map((item) => item.type)).toEqual(["AMBIGUOUS"]);
    expect(report.exceptions[0]?.reason).toMatch(/deterministic check/);
    expect(report.controls.find((control) => control.id === "X01")?.verdict).toBe("UNDECIDED");
  });

  it("records PASS(static) when a covered control is undecided and the static check found nothing", () => {
    const low = reviewDiff(
      reviewInput(clean),
      modelOf(clean, (control) => (control.id === "X01" ? { ...control, confidence: 0.4 } : control)),
      OWASP_REVIEW_KEY_ENV_LEAD,
    );
    expect(OWASP_CONFIDENCE_MIN).toBe(0.6);
    expect(low.outcome).toBe("auto-proceed");
    expect(low.failures).toEqual([]);
    expect(low.exceptions).toEqual([]);
    expect(low.controls.find((control) => control.id === "X01")).toMatchObject({
      verdict: "PASS",
      reason: PASS_STATIC_REASON,
    });

    const undecided = reviewDiff(
      reviewInput(clean),
      modelOf(clean, (control) =>
        control.id === "X01" ? { ...control, verdict: "UNDECIDED", confidence: 0.9 } : control,
      ),
      OWASP_REVIEW_KEY_ENV_LEAD,
    );
    expect(undecided.outcome).toBe("auto-proceed");
    expect(undecided.exceptions).toEqual([]);
    expect(undecided.controls.find((control) => control.id === "X01")?.reason).toBe(PASS_STATIC_REASON);
  });

  it("escalates AMBIGUOUS when an uncovered control is undecided on a changed line", () => {
    const line = "export function login(password: string) { return password; }";
    const files = [file("src/login.ts", [line])];
    const cited = reviewDiff(
      reviewInput(files),
      modelOf(files, (control) =>
        control.id === "A07"
          ? {
              ...control,
              verdict: "UNDECIDED",
              confidence: 0.9,
              path: "src/login.ts",
              line: 1,
              evidence: line,
            }
          : control,
      ),
      OWASP_REVIEW_KEY_ENV_LEAD,
    );
    expect(cited.outcome).toBe("needs-human");
    expect(cited.exceptions[0]).toMatchObject({ type: "AMBIGUOUS", controlId: "A07", path: "src/login.ts", line: 1 });
    expect(cited.exceptions[0]?.reason).toMatch(/changed line/);

    const uncited = reviewDiff(
      reviewInput(files),
      modelOf(files, (control) =>
        control.id === "A07" ? { ...control, verdict: "UNDECIDED", confidence: 0.2, path: "", line: 0, evidence: "" } : control,
      ),
      OWASP_REVIEW_KEY_ENV_LEAD,
    );
    expect(uncited.exceptions.map((item) => item.type)).not.toContain("AMBIGUOUS");
    expect(uncited.controls.find((control) => control.id === "A07")?.verdict).toBe("NOT_APPLICABLE");
    expect(uncited.outcome).toBe("auto-proceed");
  });

  it("escalates FIX_DISPUTED when Builder disputes a fix", () => {
    const report = reviewDiff(
      reviewInput(clean, {
        builderDisputes: [
          {
            id: "A03",
            disputed: true,
            reason: "the fix rejects valid input",
            path: "src/db/users.ts",
            line: 4,
          },
        ],
      }),
      modelOf(clean),
      OWASP_REVIEW_KEY_ENV_LEAD,
    );
    expect(report.outcome).toBe("needs-human");
    expect(report.failures).toEqual([]);
    expect(report.exceptions).toEqual([
      {
        type: "FIX_DISPUTED",
        controlId: "A03",
        path: "src/db/users.ts",
        line: 4,
        reason: "the fix rejects valid input",
      },
    ]);
  });

  it("escalates NOT_AUTO_FIXABLE when the model marks the fix as a design decision", () => {
    const line = 'router.post("/checkout", handler);';
    const files = [file("src/routes/checkout.ts", [line])];
    const report = reviewDiff(
      reviewInput(files),
      modelOf(files, (control) =>
        control.id === "A04"
          ? {
              ...control,
              verdict: "FAIL",
              confidence: 0.92,
              path: "src/routes/checkout.ts",
              line: 1,
              evidence: line,
              severity: "medium",
              autoFixable: false,
              suggestedFix: {
                what: "Choose the checkout boundary before adding the route.",
                where: "src/routes/checkout.ts:1",
                why: "The new route freezes an unreviewed flow.",
                owaspId: "A04",
              },
            }
          : control,
      ),
      OWASP_REVIEW_KEY_ENV_LEAD,
    );
    expect(report.outcome).toBe("needs-human");
    expect(report.failures[0]?.suggestedFix).toMatchObject({
      what: "Choose the checkout boundary before adding the route.",
      where: "src/routes/checkout.ts:1",
      why: "The new route freezes an unreviewed flow.",
      owaspId: "A04",
    });
    expect(report.failureRounds.A04).toBe(1);
    expect(report.exceptions.map((item) => item.type)).toContain("NOT_AUTO_FIXABLE");
    expect(report.exceptions.find((item) => item.type === "NOT_AUTO_FIXABLE")?.reason).toMatch(/autoFixable is false/);
  });

  it("escalates NOT_AUTO_FIXABLE after two remediation rounds and not before", () => {
    const line = 'router.post("/checkout", handler);';
    const files = [file("src/routes/checkout.ts", [line])];
    const failing = modelOf(files, (control) =>
      control.id === "A04"
        ? {
            ...control,
            verdict: "FAIL",
            confidence: 0.92,
            path: "src/routes/checkout.ts",
            line: 1,
            evidence: line,
            severity: "medium",
            autoFixable: true,
            suggestedFix: {
              what: "Authorize the checkout handler.",
              where: "src/routes/checkout.ts:1",
              why: "The route is missing an access check.",
              owaspId: "A04",
            },
          }
        : control,
    );
    const second = reviewDiff(
      reviewInput(files, { priorFailureRounds: { A04: 1 }, priorHeadSha: "1111111aaaa" }),
      failing,
      OWASP_REVIEW_KEY_ENV_LEAD,
    );
    expect(second.failureRounds.A04).toBe(2);
    expect(second.outcome).toBe("remediate");
    expect(second.exceptions).toEqual([]);

    const third = reviewDiff(
      reviewInput(files, { priorFailureRounds: { A04: 2 }, priorHeadSha: "1111111aaaa" }),
      failing,
      OWASP_REVIEW_KEY_ENV_LEAD,
    );
    expect(third.failureRounds.A04).toBe(3);
    expect(third.outcome).toBe("needs-human");
    expect(third.exceptions.find((item) => item.type === "NOT_AUTO_FIXABLE")?.reason).toMatch(/2 remediation rounds/);

    const rerun = reviewDiff(
      reviewInput(files, {
        priorFailureRounds: { A04: 2 },
        priorHeadSha: "abc1234def",
        headSha: "abc1234def",
      }),
      failing,
      OWASP_REVIEW_KEY_ENV_LEAD,
    );
    expect(rerun.failureRounds.A04).toBe(2);
    expect(rerun.outcome).toBe("remediate");
  });

  it("escalates MANUAL_REQUESTED even when every control passes", () => {
    const report = reviewDiff(
      reviewInput(clean, {
        manualReview: true,
        manualReviewReason: "pull request label security-manual-review",
      }),
      modelOf(clean),
      OWASP_REVIEW_KEY_ENV_LEAD,
    );
    expect(report.outcome).toBe("needs-human");
    expect(report.failures).toEqual([]);
    expect(report.exceptions).toEqual([
      {
        type: "MANUAL_REQUESTED",
        controlId: null,
        path: null,
        line: null,
        reason: "pull request label security-manual-review",
      },
    ]);
  });
});

describe("runOwaspReview", () => {
  it("skips visibly when neither exclusive key is set and leaves shared keys unused", async () => {
    let called = false;
    const report = await runOwaspReview(reviewInput(clean), {
      env: { XAI_API_KEY: "shared-xai-value", GROK_API_KEY: "shared-grok-value" },
      fetchImpl: async () => {
        called = true;
        throw new Error("network must not be called");
      },
    });
    expect(called).toBe(false);
    expect(report.status).toBe("skipped");
    expect(report.outcome).toBe("skipped");
    expect(report.outcome).not.toBe("auto-proceed");
    expect(report.risk).toBe("not_assessed");
    expect(report.keyEnvVar).toBeNull();
    expect(report.controls).toEqual([]);
    expect(report.error).toMatch(/is set/);
    const comment = renderOwaspReviewComment(report);
    expect(comment).not.toContain("shared-xai-value");
    expect(comment).toMatch(/skipped/i);
  });

  it("uses the Security key when it is set, otherwise the Lead key, and names the variable", async () => {
    const seen: { auth?: string } = {};
    const fetchImpl: typeof fetch = async (_url, init) => {
      seen.auth = new Headers(init?.headers).get("Authorization") ?? "";
      return Response.json({
        model: "grok-4.3",
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                controls: [
                  {
                    id: "X01",
                    verdict: "PASS",
                    confidence: 0.9,
                    path: "",
                    line: 0,
                    evidence: "",
                    severity: "none",
                    autoFixable: true,
                    suggestedFix: { what: "", where: "", why: "", owaspId: "X01" },
                  },
                ],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      });
    };
    const security = await runOwaspReview(reviewInput(clean), {
      env: {
        RELEASEDESK_GROK_API_KEY_SECURITY: SECURITY_KEY,
        RELEASEDESK_GROK_API_KEY_LEAD: LEAD_KEY,
      },
      fetchImpl,
    });
    expect(security.keyEnvVar).toBe(OWASP_REVIEW_KEY_ENV_SECURITY);
    expect(seen.auth).toBe(`Bearer ${SECURITY_KEY}`);
    expect(renderOwaspReviewComment(security)).not.toContain(SECURITY_KEY);

    const lead = await runOwaspReview(reviewInput(clean), {
      env: { RELEASEDESK_GROK_API_KEY_LEAD: LEAD_KEY, XAI_API_KEY: "shared-xai-value" },
      fetchImpl,
    });
    expect(lead.keyEnvVar).toBe(OWASP_REVIEW_KEY_ENV_LEAD);
    expect(lead.outcome).toBe("auto-proceed");
    expect(seen.auth).toBe(`Bearer ${LEAD_KEY}`);
  });

  it("sends only the selected controls to Grok", async () => {
    const seen: { body?: { messages?: Array<{ content?: string }>; max_tokens?: number; guidelines?: unknown } } = {};
    const docs = [file("docs/guide.md", ["This note mentions password and jwt."])];
    const report = await runOwaspReview(reviewInput(docs), {
      env: { RELEASEDESK_GROK_API_KEY_LEAD: LEAD_KEY },
      fetchImpl: async (url, init) => {
        expect(String(url)).toBe("https://api.x.ai/v1/chat/completions");
        seen.body = JSON.parse(String(init?.body)) as typeof seen.body;
        expect(new Headers(init?.headers).get("x-grok-conv-id")).toBe("owasp-review:v1:vishamathur/mvp-releasedesk:pr:7");
        return Response.json({
          model: "grok-4.3",
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  controls: [
                    {
                      id: "X01",
                      verdict: "NOT_APPLICABLE",
                      confidence: 0.88,
                      path: "",
                      line: 0,
                      evidence: "",
                      severity: "none",
                      autoFixable: true,
                      suggestedFix: { what: "", where: "", why: "", owaspId: "X01" },
                    },
                  ],
                }),
              },
            },
          ],
        });
      },
    });
    const user = seen.body?.messages?.[1]?.content ?? "";
    expect(user).toContain('controlIds: ["X01"]');
    expect(user).not.toContain('"A03"');
    expect(user).not.toContain('"LLM01"');
    expect(seen.body?.max_tokens).toBe(OWASP_REVIEW_MAX_TOKENS);
    expect(seen.body?.guidelines).toBeTruthy();
    const body = seen.body as { safety_identifier?: string };
    expect(body.safety_identifier).toBe(hashSafetyIdentifier("security:vishamathur/mvp-releasedesk"));
    expect(report.outcome).toBe("auto-proceed");
    expect(report.docsOnly).toBe(true);
    expect(report.selectedControlIds).toEqual(["X01"]);
  });

  it("fails visibly on a Grok transport error, a guideline rejection, a timeout, and invalid JSON", async () => {
    const env = { RELEASEDESK_GROK_API_KEY_LEAD: LEAD_KEY };
    const transport = await runOwaspReview(reviewInput(clean), {
      env,
      fetchImpl: async () => {
        throw new Error(`socket closed while using ${LEAD_KEY}`);
      },
    });
    expect(transport.status).toBe("failed");
    expect(transport.outcome).toBe("needs-human");
    expect(transport.risk).toBe("not_assessed");
    expect(transport.controls).toEqual([]);
    expect(transport.exceptions[0]?.type).toBe("REVIEW_FAILED");
    expect(transport.error).not.toContain(LEAD_KEY);
    expect(renderOwaspReviewComment(transport)).not.toContain(LEAD_KEY);

    const rejected = await runOwaspReview(reviewInput(clean), {
      env,
      fetchImpl: async () => new Response("no", { status: 400 }),
    });
    expect(rejected.outcome).toBe("needs-human");
    expect(rejected.error).toMatch(/400/);
    expect(rejected.controls).toEqual([]);

    let timeouts = 0;
    const timeout = await runOwaspReview(reviewInput(clean), {
      env,
      retryDelayMs: 0,
      sleepImpl: async () => undefined,
      fetchImpl: async () => {
        timeouts += 1;
        const error = new Error("The operation was aborted due to timeout");
        error.name = "TimeoutError";
        throw error;
      },
    });
    expect(timeouts).toBe(2);
    expect(timeout.error).toMatch(/timed out/);
    expect(timeout.outcome).not.toBe("auto-proceed");
    expect(timeout.status).toBe("failed");

    const invalid = await runOwaspReview(reviewInput(clean), {
      env,
      fetchImpl: async () =>
        Response.json({
          choices: [{ finish_reason: "stop", message: { content: "not json" } }],
        }),
    });
    expect(invalid.status).toBe("failed");
    expect(invalid.error).toMatch(/not valid JSON/);
    expect(invalid.outcome).toBe("needs-human");
  });

  it("retries a 5xx once and then accepts the live judgement", async () => {
    const env = { RELEASEDESK_GROK_API_KEY_LEAD: LEAD_KEY };
    let calls = 0;
    const delays: number[] = [];
    const report = await runOwaspReview(reviewInput(clean), {
      env,
      retryDelayMs: 20,
      sleepImpl: async (ms) => {
        delays.push(ms);
      },
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return new Response("unavailable", { status: 503 });
        return Response.json({
          model: "grok-4.3",
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  controls: [
                    {
                      id: "X01",
                      verdict: "PASS",
                      confidence: 0.9,
                      path: "",
                      line: 0,
                      evidence: "",
                      severity: "none",
                      autoFixable: true,
                      suggestedFix: { what: "", where: "", why: "", owaspId: "X01" },
                    },
                  ],
                }),
              },
            },
          ],
        });
      },
    });
    expect(calls).toBe(2);
    expect(delays).toEqual([20]);
    expect(report.outcome).toBe("auto-proceed");
    expect(report.status).toBe("completed");
  });

  it("sends at most six controls per call and does not drop files when the diff is split", async () => {
    const env = { RELEASEDESK_GROK_API_KEY_SECURITY: SECURITY_KEY, OWASP_REVIEW_DIFF_TOKEN_BUDGET: "400" };
    const rich = [
      file("src/login.ts", [
        "export function login(password: string) {",
        "  const session = password;",
        "  console.error(password);",
        '  const sql = "SELECT id FROM users WHERE name = \'" + password + "\'";',
        "  db.query(sql);",
        "  return session;",
        "}",
      ]),
    ];
    const fat = ["a.ts", "b.ts", "c.ts"].map((path) => file(path, ["const n = 1;", "x".repeat(2000)]));
    const batches: string[][] = [];
    const bodies: string[] = [];
    const selected = selectControls(rich)
      .controls.filter((control) => control.selected)
      .map((control) => control.id);
    expect(selected.length).toBeGreaterThan(OWASP_REVIEW_BATCH_SIZE);

    const richReport = await runOwaspReview(reviewInput(rich), {
      env,
      retryDelayMs: 0,
      sleepImpl: async () => undefined,
      fetchImpl: async (_url, init) => {
        const user = JSON.parse(String(init?.body)).messages[1].content as string;
        const match = user.match(/controlIds: (\[[^\]]*\])/);
        const ids = JSON.parse(match?.[1] ?? "[]") as string[];
        batches.push(ids);
        return Response.json({
          model: "grok-4.3",
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  controls: ids.map((id) => ({
                    id,
                    verdict: "PASS",
                    confidence: 0.9,
                    path: "",
                    line: 0,
                    evidence: "",
                    severity: "none",
                    autoFixable: true,
                    suggestedFix: { what: "", where: "", why: "", owaspId: id },
                  })),
                }),
              },
            },
          ],
        });
      },
    });
    expect(richReport.outcome).toBe("auto-proceed");
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) expect(batch.length).toBeLessThanOrEqual(OWASP_REVIEW_BATCH_SIZE);
    expect([...new Set(batches.flat())].sort()).toEqual([...selected].sort());

    const split = await runOwaspReview(reviewInput(fat), {
      env,
      retryDelayMs: 0,
      sleepImpl: async () => undefined,
      fetchImpl: async (_url, init) => {
        const user = JSON.parse(String(init?.body)).messages[1].content as string;
        bodies.push(user);
        return Response.json({
          model: "grok-4.3",
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  controls: [
                    {
                      id: "X01",
                      verdict: "PASS",
                      confidence: 0.9,
                      path: "",
                      line: 0,
                      evidence: "",
                      severity: "none",
                      autoFixable: true,
                      suggestedFix: { what: "", where: "", why: "", owaspId: "X01" },
                    },
                  ],
                }),
              },
            },
          ],
        });
      },
    });
    expect(split.diffTruncated).toBe(false);
    expect(split.filesSent).toBe(3);
    expect(split.filesTotal).toBe(3);
    expect(bodies.length).toBeGreaterThan(1);
    for (const path of ["a.ts", "b.ts", "c.ts"]) {
      expect(bodies.some((text) => text.includes(`a/${path}`))).toBe(true);
    }
    expect(bodies.every((text) => text.includes("truncated=false"))).toBe(true);
  });

  it("grounds a two-line SQL statement and ignores detector lines and placeholder fixtures", () => {
    const sqlLines = [
      "  const sql =",
      `    "SELECT id, username, password_hash FROM customers WHERE username = '" + username + "'";`,
    ];
    const sqlFile = "apps/kyc/src/e2e-sample/customer-query.ts";
    const sqlEvidence = `const sql = "SELECT id, username, password_hash FROM customers WHERE username = '" + username + "'";`;
    const sqlFiles = [file(sqlFile, sqlLines)];
    const sql = reviewDiff(
      reviewInput(sqlFiles),
      modelOf(sqlFiles, (control) =>
        control.id === "A03"
          ? {
              ...control,
              verdict: "FAIL",
              confidence: 0.93,
              path: sqlFile,
              line: 2,
              evidence: sqlEvidence,
              severity: "high",
            }
          : control,
      ),
      OWASP_REVIEW_KEY_ENV_LEAD,
    );
    expect(sql.droppedUngrounded).toEqual([]);
    expect(sql.failures.some((failure) => failure.id === "A03" && failure.line === 2)).toBe(true);
    expect(sql.outcome).toBe("remediate");

    const detector = String.raw`const INJECTION_RE = /\beval\s*\(|dangerouslySetInnerHTML/;`;
    const detectorPath = "packages/releasedesk-core/src/owasp-review/select.ts";
    const detectorFiles = [file(detectorPath, [detector])];
    const ignored = reviewDiff(
      reviewInput(detectorFiles),
      modelOf(detectorFiles, (control) =>
        control.id === "A03"
          ? {
              ...control,
              verdict: "FAIL",
              confidence: 0.95,
              path: detectorPath,
              line: 1,
              evidence: detector,
              severity: "high",
            }
          : control,
      ),
      OWASP_REVIEW_KEY_ENV_LEAD,
    );
    expect(ignored.failures.filter((failure) => failure.id === "A03")).toEqual([]);
    expect(ignored.controls.find((control) => control.id === "A03")?.verdict).toBe("PASS");

    const realCall = "eval(input);";
    const callFiles = [file("src/run.ts", [realCall])];
    const kept = reviewDiff(reviewInput(callFiles), modelOf(callFiles), OWASP_REVIEW_KEY_ENV_LEAD);
    expect(kept.failures.some((failure) => failure.id === "A03" && failure.evidence === realCall)).toBe(true);

    const fixture = 'env: { XAI_API_KEY: "shared-xai-value", GROK_API_KEY: "shared-grok-value" },';
    const fixturePath = "packages/releasedesk-core/src/owasp-review/review.test.ts";
    const fixtureFiles = [file(fixturePath, [fixture])];
    const placeholder = reviewDiff(
      reviewInput(fixtureFiles),
      modelOf(fixtureFiles, (control) =>
        control.id === "X01"
          ? {
              ...control,
              verdict: "FAIL",
              confidence: 0.98,
              path: fixturePath,
              line: 1,
              evidence: fixture,
              severity: "high",
            }
          : control,
      ),
      OWASP_REVIEW_KEY_ENV_LEAD,
    );
    expect(placeholder.failures.filter((failure) => failure.id === "X01")).toEqual([]);

    const live = secretLine();
    const livePath = "src/keys.test.ts";
    const liveFiles = [file(livePath, [live])];
    const stillSecret = reviewDiff(
      reviewInput(liveFiles),
      modelOf(liveFiles, (control) =>
        control.id === "X01"
          ? {
              ...control,
              verdict: "FAIL",
              confidence: 0.96,
              path: livePath,
              line: 1,
              evidence: live,
              severity: "high",
            }
          : control,
      ),
      OWASP_REVIEW_KEY_ENV_LEAD,
    );
    expect(stillSecret.failures.some((failure) => failure.id === "X01" && failure.path === livePath)).toBe(true);
  });
});
