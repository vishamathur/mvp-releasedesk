import { describe, expect, it } from "vitest";
import {
  DEMO_PORTFOLIO,
  SDLC_AGENT_DEFINITIONS,
  assertExclusiveApiKeys,
} from "@releasedesk/core";
import { getSdlcMvpCatalog, runSdlcMvpPortfolioCheck } from "./sdlc-mvp";

describe("sdlc-mvp portfolio check", () => {
  it("runs DEMO_PORTFOLIO with customerId tags, mandatory security, and token savings", async () => {
    const report = await runSdlcMvpPortfolioCheck(DEMO_PORTFOLIO, {});

    expect(report.customers).toHaveLength(DEMO_PORTFOLIO.length);
    expect(report.requirements.agility.customersChecked).toBe(DEMO_PORTFOLIO.length);
    expect(report.requirements.agility.allTaggedWithCustomerId).toBe(true);

    for (const customer of report.customers) {
      const expected = DEMO_PORTFOLIO.find((c) => c.customerId === customer.customerId);
      expect(expected).toBeDefined();
      expect(customer.runId).toMatch(/^run_/);
      expect(customer.security.ok).toBe(true);
      expect(customer.security.securityCompleted).toBe(true);
      expect(customer.security.hasRecordedResult).toBe(true);
      expect(customer.tokenBudget.savingsTokensEst).toBeGreaterThan(0);
      expect(customer.tokenBudget.savingsPct).toBeGreaterThan(0);
      expect(customer.mockIntegrations.specialists).toBe(true);
      expect(customer.mockIntegrations.prClient).toBe("mock");
    }

    expect(report.requirements.security.mandatoryOnEveryChange).toBe(true);
    expect(report.requirements.security.allCustomersOk).toBe(true);
    expect(report.requirements.tokenEfficiency.totalSavingsTokensEst).toBeGreaterThan(0);
    expect(report.requirements.tokenEfficiency.averageSavingsPct).toBeGreaterThan(0);
    expect(report.agents.map((a) => a.id)).toEqual(
      SDLC_AGENT_DEFINITIONS.map((a) => a.id),
    );
    expect(report.credentials.every((c) => c.present === false)).toBe(true);
    expect(report.credentials.every((c) => c.usedSharedFallback === false)).toBe(true);
    expect(report.mockNote).toMatch(/MOCK/);
  });

  it("catalog exposes agents and credential statuses without secret values", () => {
    const catalog = getSdlcMvpCatalog({
      RELEASEDESK_GROK_API_KEY_SECURITY: "secret-should-not-leak",
    });
    expect(catalog.agents.length).toBe(SDLC_AGENT_DEFINITIONS.length);
    expect(catalog.portfolio).toEqual([...DEMO_PORTFOLIO]);
    const securityCred = catalog.credentials.find(
      (c) => c.envVar === "RELEASEDESK_GROK_API_KEY_SECURITY",
    );
    expect(securityCred?.present).toBe(true);
    expect(JSON.stringify(catalog)).not.toContain("secret-should-not-leak");
    expect(() => assertExclusiveApiKeys(catalog.agents)).not.toThrow();
  });
});
