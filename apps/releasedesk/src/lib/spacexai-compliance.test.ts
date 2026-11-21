import { describe, expect, it } from "vitest";
import { buildSpaceXaiComplianceSnapshot, SPACEXAI_REQUIRED_NHI_SLOTS } from "./spacexai-compliance";

describe("buildSpaceXaiComplianceSnapshot", () => {
  it("stays MOCK without the app key and ignores per-bot keys", () => {
    const snap = buildSpaceXaiComplianceSnapshot({
      RELEASEDESK_GROK_API_KEY_LEAD: "per-bot",
      CURSOR_API_KEY: "shared-ignored",
      RELEASEDESK_CLOUD_CLIENT: "real",
    });
    expect(SPACEXAI_REQUIRED_NHI_SLOTS).toHaveLength(1);
    expect(snap.nhiSlots.presentCount).toBe(0);
    expect(snap.nhiSlots.missing).toEqual(["XAI_API_KEY"]);
    expect(snap.chips.grokApi).toBe("MOCK");
    expect(snap.chips.cursorCloud).toBe("MOCK");
    expect(snap.cloudClientMode).toBe("mock");
    expect(snap.compliancePct).toBe(92);
    expect(snap.credentials.every((c) => c.usedSharedFallback === false)).toBe(true);
    expect(JSON.stringify(snap)).not.toContain("per-bot");
  });

  it("marks Grok LIVE from XAI_API_KEY and keeps the Cursor chip MOCK", () => {
    const snap = buildSpaceXaiComplianceSnapshot({
      XAI_API_KEY: "app-key",
      RELEASEDESK_CLOUD_CLIENT: "real",
    });
    expect(snap.nhiSlots.presentCount).toBe(1);
    expect(snap.nhiSlots.missing).toEqual([]);
    expect(snap.chips.grokApi).toBe("LIVE");
    expect(snap.chips.cursorCloud).toBe("MOCK");
    expect(snap.compliancePct).toBe(100);
    expect(JSON.stringify(snap)).not.toContain("app-key");
  });
});
