import { describe, expect, it } from "vitest";
import {
  auditLine,
  branchProtectionBody,
  CustomerRepoError,
  customerRepoName,
  DEFAULT_REQUIRED_CHECKS,
  FREE_PLAN_PROTECTION_WARNING,
  isFreePlanProtectionError,
  parseLabelsFile,
  planArchiveCustomerRepo,
  planCreateCustomerRepo,
  requireFinanceApproval,
  validateCustomerRepoName,
  xaiCreateKeyRequest,
  xaiDeleteKeyRequest,
} from "./index.js";

const approvedState = {
  requestId: "REQ-2026-0001",
  decisions: [
    {
      gate: "finance-approval",
      status: "approved",
      decidedBy: "Vishal Mathur (Finance partner)",
      note: "fund for next sprint",
    },
  ],
};

const baseOptions = {
  customerId: "cust_northwind",
  customerName: "Northwind Bank",
  request: "kyc-identity",
  requestId: "REQ-2026-0001",
  statePath: "/tmp/state.json",
  customerDbPath: "/tmp/customers.json",
  auditPath: "/tmp/audit.jsonl",
};

describe("customer repo name rule", () => {
  it("builds <customer>-<request> and <customer>-ER", () => {
    expect(customerRepoName("Northwind Bank", "kyc-identity")).toBe("northwind-bank-kyc-identity");
    expect(customerRepoName("Acme", "KYC Occupation")).toBe("acme-kyc-occupation");
    expect(customerRepoName("Acme", "ER")).toBe("acme-ER");
    expect(customerRepoName("Acme", "er")).toBe("acme-ER");
    expect(customerRepoName("Café Ünited", "ER")).toBe("cafe-united-ER");
  });

  it("rejects names that break the rule", () => {
    expect(validateCustomerRepoName("acme").ok).toBe(false);
    expect(validateCustomerRepoName("Acme-ER").ok).toBe(false);
    expect(validateCustomerRepoName("acme--ER").ok).toBe(false);
    expect(validateCustomerRepoName("acme-Er").ok).toBe(false);
    expect(validateCustomerRepoName(`acme-${"x".repeat(100)}`).ok).toBe(false);
    expect(validateCustomerRepoName("acme-ER").ok).toBe(true);
    expect(() => customerRepoName("!!!", "ER")).toThrow(CustomerRepoError);
    expect(() => customerRepoName("Acme", "  ")).toThrow(/request slug/);
  });
});

describe("finance-approval guard", () => {
  it("returns the approved finance decision", () => {
    expect(requireFinanceApproval(approvedState, "REQ-2026-0001").decidedBy).toBe(
      "Vishal Mathur (Finance partner)",
    );
  });

  it("accepts an approved decision recorded on a transition", () => {
    const state = {
      requestId: "REQ-2026-0002",
      transitions: [
        { humanDecision: { gate: "finance-approval", status: "approved", decidedBy: "Vishal Mathur" } },
      ],
    };
    expect(requireFinanceApproval(state, "REQ-2026-0002").decidedBy).toBe("Vishal Mathur");
  });

  it("refuses without an approved finance decision", () => {
    expect(() => requireFinanceApproval({ requestId: "REQ-1", decisions: [] }, "REQ-1")).toThrow(
      /no approved finance-approval decision \(found: none\)/,
    );
    expect(() =>
      requireFinanceApproval(
        { requestId: "REQ-1", decisions: [{ gate: "finance-approval", status: "pending", decidedBy: "" }] },
        "REQ-1",
      ),
    ).toThrow(/found: pending/);
    expect(() =>
      requireFinanceApproval(
        { requestId: "REQ-1", decisions: [{ gate: "security-compliance-approval", status: "approved", decidedBy: "V" }] },
        "REQ-1",
      ),
    ).toThrow(CustomerRepoError);
    expect(() =>
      requireFinanceApproval(
        { requestId: "REQ-1", decisions: [{ gate: "finance-approval", status: "approved", decidedBy: "  " }] },
        "REQ-1",
      ),
    ).toThrow(CustomerRepoError);
  });

  it("refuses a state file for another request", () => {
    expect(() => requireFinanceApproval(approvedState, "REQ-2026-0009")).toThrow(/is for REQ-2026-0001/);
    expect(() => requireFinanceApproval(null, "REQ-1")).toThrow(/not a JSON object/);
  });
});

describe("dry-run planning", () => {
  it("plans every create step without a network call", () => {
    const plan = planCreateCustomerRepo(baseOptions, approvedState);
    expect(plan.repository).toBe("vishamathur/northwind-bank-kyc-identity");
    expect(plan.baseRef).toBe("main");
    expect(plan.steps.map((s) => s.id)).toEqual([
      "check-free",
      "create",
      "wait-main",
      "protect",
      "labels",
      "mint-key",
      "set-secret",
      "customer-record",
      "request-target",
      "audit",
    ]);
    const create = plan.steps.find((s) => s.id === "create");
    expect(create?.gh).toEqual([
      "repo",
      "create",
      "vishamathur/northwind-bank-kyc-identity",
      "--private",
      "--template",
      "vishamathur/releasedesk-customer-template",
    ]);
    const secret = plan.steps.find((s) => s.id === "set-secret");
    expect(secret?.gh).toEqual(["secret", "set", "RELEASEDESK_GROK_API_KEY_LEAD", "-R", plan.repository]);
    expect(plan.steps.find((s) => s.id === "mint-key")?.http?.url).toBe(
      "https://management-api.x.ai/auth/teams/%3CXAI_TEAM_ID%3E/api-keys",
    );
    expect(JSON.stringify(plan)).not.toMatch(/xai-[A-Za-z0-9]{10}/);
  });

  it("does not plan anything when finance is not approved", () => {
    expect(() => planCreateCustomerRepo(baseOptions, { requestId: "REQ-2026-0001" })).toThrow(
      /no approved finance-approval/,
    );
  });

  it("plans archive-on-reject and refuses without a rejection", () => {
    const rejected = {
      requestId: "REQ-2026-0003",
      decisions: [{ gate: "security-compliance-approval", status: "rejected", decidedBy: "Vishal Mathur" }],
      target: { repository: "vishamathur/acme-ER", baseRef: "main", grokKeyId: "key-123" },
    };
    const plan = planArchiveCustomerRepo(
      { repository: "vishamathur/acme-ER", requestId: "REQ-2026-0003", statePath: "s", auditPath: "a" },
      rejected,
    );
    expect(plan.steps.map((s) => s.id)).toEqual(["revoke-key", "delete-secret", "archive", "request-target", "audit"]);
    expect(plan.steps[0]?.http).toEqual({ method: "DELETE", url: "https://management-api.x.ai/auth/api-keys/key-123" });
    expect(() =>
      planArchiveCustomerRepo(
        { repository: "vishamathur/other-ER", requestId: "REQ-2026-0003", statePath: "s", auditPath: "a" },
        rejected,
      ),
    ).toThrow(/targets vishamathur\/acme-ER/);
    expect(() =>
      planArchiveCustomerRepo(
        { repository: "vishamathur/acme-ER", requestId: "REQ-2026-0001", statePath: "s", auditPath: "a" },
        approvedState,
      ),
    ).toThrow(/no rejected gate decision/);
  });
});

describe("request bodies", () => {
  it("protects main with a PR, no GitHub approvals, required checks, no force-push or deletion", () => {
    const body = branchProtectionBody(DEFAULT_REQUIRED_CHECKS);
    expect(body.required_status_checks.contexts).toEqual(["ci", "grok-review / review", "owasp-review / review"]);
    expect(body.required_pull_request_reviews.required_approving_review_count).toBe(0);
    expect(body.required_status_checks.strict).toBe(true);
    expect(body.allow_force_pushes).toBe(false);
    expect(body.allow_deletions).toBe(false);
  });

  it("uses the documented xAI Management API endpoints", () => {
    expect(xaiCreateKeyRequest("team-1", "releasedesk-x")).toEqual({
      method: "POST",
      url: "https://management-api.x.ai/auth/teams/team-1/api-keys",
      body: { name: "releasedesk-x", acls: ["api-key:endpoint:chat", "api-key:model:grok-4.3"] },
    });
    expect(xaiDeleteKeyRequest("k1").url).toBe("https://management-api.x.ai/auth/api-keys/k1");
    expect(() => xaiDeleteKeyRequest("")).toThrow(/no Grok apiKeyId/);
  });

  it("writes one JSON audit line and parses the labels file", () => {
    const line = auditLine({
      schema: "customer-repo-audit.v1",
      action: "create",
      requestId: "REQ-2026-0001",
      repository: "vishamathur/northwind-bank-kyc-identity",
      financeApprovedBy: "Vishal Mathur",
      protection: "applied",
      at: "2026-11-27T14:30:00+05:30",
      by: "create-customer-repo",
    });
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line).financeApprovedBy).toBe("Vishal Mathur");
    expect(
      parseLabelsFile('# c\n- { name: "type:story", color: "1d76db", description: "User story" }\n'),
    ).toEqual([{ name: "type:story", color: "1d76db", description: "User story" }]);
    expect(() => parseLabelsFile('- { name: "x", color: "zz" }')).toThrow(/invalid entry/);
  });
});

describe("branch protection on GitHub Free", () => {
  // stderr from `gh api -X PUT repos/vishamathur/northwind-bank-kyc-identity/branches/main/protection`, 2026-11-27.
  const freePlan =
    "gh api -X PUT failed: gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)";

  it("matches only GitHub's 403 plan-upgrade error", () => {
    expect(isFreePlanProtectionError(freePlan)).toBe(true);
    expect(isFreePlanProtectionError("gh api -X PUT failed: gh: Resource not accessible by integration (HTTP 403)")).toBe(false);
    expect(isFreePlanProtectionError("gh api -X PUT failed: gh: Must have admin rights to Repository. (HTTP 403)")).toBe(false);
    expect(isFreePlanProtectionError("gh api -X PUT failed: gh: Not Found (HTTP 404)")).toBe(false);
    expect(isFreePlanProtectionError("gh api -X PUT failed: gh: Validation Failed (HTTP 422)")).toBe(false);
    expect(isFreePlanProtectionError("gh api -X PUT failed: connect ETIMEDOUT")).toBe(false);
    expect(
      isFreePlanProtectionError("Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 500)"),
    ).toBe(false);
  });

  it("warns that enforcement relies on the Release Desk gates", () => {
    expect(FREE_PLAN_PROTECTION_WARNING).toMatch(/NOT enforced by GitHub/);
    expect(FREE_PLAN_PROTECTION_WARNING).toMatch(/security-compliance/);
    expect(FREE_PLAN_PROTECTION_WARNING).toMatch(/release gates/);
    expect(FREE_PLAN_PROTECTION_WARNING).toMatch(/required reviews by the Release Desk bots/);
  });

  it("records unavailable-free-plan in the audit line", () => {
    const line = JSON.parse(
      auditLine({
        schema: "customer-repo-audit.v1",
        action: "create",
        requestId: "REQ-2026-0004",
        repository: "vishamathur/acme-ER",
        protection: "unavailable-free-plan",
        at: "2026-11-27T14:40:00+05:30",
        by: "create-customer-repo",
      }),
    );
    expect(line.protection).toBe("unavailable-free-plan");
  });

  it("plans protection before the key, with the free-plan rule in the step", () => {
    const plan = planCreateCustomerRepo(baseOptions, approvedState);
    const ids = plan.steps.map((s) => s.id);
    expect(ids.indexOf("protect")).toBeLessThan(ids.indexOf("mint-key"));
    expect(plan.steps.find((s) => s.id === "protect")?.description).toMatch(
      /GitHub Free 403 plan-upgrade: record unavailable-free-plan, warn, continue; any other error stops/,
    );
  });
});
