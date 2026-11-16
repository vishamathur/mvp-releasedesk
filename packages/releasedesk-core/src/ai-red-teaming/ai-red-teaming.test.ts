import { describe, expect, it } from "vitest";
import { isMockNote } from "../mock.js";
import {
  AI_RED_TEAM_PROVIDER_ENV,
  createCustomAiRedTeamingProvider,
  createZscalerAiRedTeamingProvider,
  DEFAULT_AI_RED_TEAM_PROVIDER,
  parseAiRedTeamProviderName,
  resolveAiRedTeamingProvider,
  ZSCALER_NOT_WIRED_CODE,
  ZscalerAiRedTeamNotWiredError,
} from "./index.js";

const target = {
  repository: "vishamathur/mvp-releasedesk",
  appLabel: "northwind-kyc",
};
const frameworks = ["atlas", "owasp_llm_top_10"] as const;

describe("parseAiRedTeamProviderName", () => {
  it("defaults to custom when unset/empty/unknown", () => {
    expect(parseAiRedTeamProviderName(undefined)).toBe("custom");
    expect(parseAiRedTeamProviderName("")).toBe("custom");
    expect(parseAiRedTeamProviderName("splx")).toBe("custom");
    expect(DEFAULT_AI_RED_TEAM_PROVIDER).toBe("custom");
  });

  it("accepts custom and zscaler (case-insensitive)", () => {
    expect(parseAiRedTeamProviderName("custom")).toBe("custom");
    expect(parseAiRedTeamProviderName("ZSCALER")).toBe("zscaler");
  });
});

describe("resolveAiRedTeamingProvider factory", () => {
  it("selects custom by default (off / unset env)", () => {
    const provider = resolveAiRedTeamingProvider({ env: {} });
    expect(provider.name).toBe("custom");
  });

  it(`selects zscaler when ${AI_RED_TEAM_PROVIDER_ENV}=zscaler`, () => {
    const provider = resolveAiRedTeamingProvider({
      env: { [AI_RED_TEAM_PROVIDER_ENV]: "zscaler" },
    });
    expect(provider.name).toBe("zscaler");
  });

  it("honors explicit provider override over env", () => {
    const provider = resolveAiRedTeamingProvider({
      provider: "custom",
      env: { [AI_RED_TEAM_PROVIDER_ENV]: "zscaler" },
    });
    expect(provider.name).toBe("custom");
  });

  it("returns injected client when provided", () => {
    const client = createCustomAiRedTeamingProvider();
    expect(resolveAiRedTeamingProvider({ client }).name).toBe("custom");
  });
});

describe("custom provider", () => {
  it("healthCheck is ok in mock mode", async () => {
    const provider = createCustomAiRedTeamingProvider();
    const health = await provider.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.mode).toBe("mock");
    expect(health.provider).toBe("custom");
    expect(isMockNote(health.message)).toBe(true);
  });

  it("runProbes returns ATLAS/OWASP-mapped findings", async () => {
    const provider = createCustomAiRedTeamingProvider();
    const result = await provider.runProbes(target, frameworks);
    expect(result.provider).toBe("custom");
    expect(result.mode).toBe("mock");
    expect(result.findings.length).toBeGreaterThan(0);
    for (const f of result.findings) {
      expect(f.atlas.length + f.owasp.length).toBeGreaterThan(0);
      expect(isMockNote(f.summary)).toBe(true);
    }
  });
});

describe("zscaler provider MOCK without credentials", () => {
  it("healthCheck reports MOCK when no credentials", async () => {
    const provider = createZscalerAiRedTeamingProvider({ env: {}, apiKey: null });
    const health = await provider.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.mode).toBe("mock");
    expect(health.provider).toBe("zscaler");
    expect(isMockNote(health.message)).toBe(true);
  });

  it("runProbes returns MOCK-labeled sample findings mapped to ATLAS/OWASP", async () => {
    const provider = createZscalerAiRedTeamingProvider({ env: {}, apiKey: null });
    const result = await provider.runProbes(target, frameworks);
    expect(result.provider).toBe("zscaler");
    expect(result.mode).toBe("mock");
    expect(result.findings.length).toBeGreaterThan(0);
    expect(isMockNote(result.summary)).toBe(true);
    expect(result.mocksUsed.some((m) => m.mockLabel === "zscaler-ai-red-teaming")).toBe(
      true,
    );

    for (const f of result.findings) {
      expect(f.mocked).toBe(true);
      expect(f.title.startsWith("MOCK:") || isMockNote(f.summary)).toBe(true);
      expect(isMockNote(f.summary)).toBe(true);
      expect(f.atlas.length).toBeGreaterThan(0);
      expect(f.owasp.length).toBeGreaterThan(0);
    }

    const atlasIds = result.findings.flatMap((f) => f.atlas);
    const owaspIds = result.findings.flatMap((f) => f.owasp);
    expect(atlasIds.some((id) => id.startsWith("AML."))).toBe(true);
    expect(owaspIds.some((id) => id.startsWith("LLM"))).toBe(true);
  });

  it("factory zscaler path without credentials yields MOCK findings", async () => {
    const provider = resolveAiRedTeamingProvider({
      env: { [AI_RED_TEAM_PROVIDER_ENV]: "zscaler" },
      zscalerApiKey: null,
    });
    expect(provider.name).toBe("zscaler");
    const result = await provider.runProbes(target, ["atlas"]);
    expect(result.mode).toBe("mock");
    expect(result.findings.every((f) => f.mocked)).toBe(true);
  });
});

describe("zscaler provider with credentials (not wired)", () => {
  it("healthCheck reports not_wired and runProbes throws", async () => {
    const provider = createZscalerAiRedTeamingProvider({
      apiKey: "test-key-not-for-live-use",
    });
    const health = await provider.healthCheck();
    expect(health.ok).toBe(false);
    expect(health.mode).toBe("not_wired");

    await expect(provider.runProbes(target, frameworks)).rejects.toMatchObject({
      name: "ZscalerAiRedTeamNotWiredError",
      code: ZSCALER_NOT_WIRED_CODE,
    });
    await expect(provider.runProbes(target, frameworks)).rejects.toBeInstanceOf(
      ZscalerAiRedTeamNotWiredError,
    );
  });
});
