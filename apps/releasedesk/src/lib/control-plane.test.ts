import { describe, expect, it } from "vitest";
import { buildControlPlaneSnapshot } from "./control-plane";

describe("buildControlPlaneSnapshot", () => {
  it("returns seven stages covering enterprise SDLC depth", async () => {
    const snap = await buildControlPlaneSnapshot({
      XAI_API_KEY: "shared-ignored",
    });
    expect(snap.title).toBe("Release Desk SDLC Control Plane");
    expect(snap.stages).toHaveLength(7);
    expect(snap.stages.map((s) => s.id)).toEqual([
      "intake",
      "grok_bots",
      "atlas_owasp",
      "iteration_gate",
      "cursor_grok_ship",
      "human_merge_release",
      "portfolio_token_nhi",
    ]);
    expect(snap.iterationGate.canProceed).toBe(true);
    expect(snap.atlasOwasp.atlasTags.length + snap.atlasOwasp.owaspTags.length).toBeGreaterThan(0);
    expect(snap.ship.specialistIntel.classify.mocked).toBe(true);
    expect(snap.portfolio.customers.length).toBeGreaterThanOrEqual(2);
    expect(snap.nhiCredentials.every((c) => c.usedSharedFallback === false)).toBe(true);
    expect(snap.demoPath[0]).toMatch(/build:core/);
  }, 30_000);
});
