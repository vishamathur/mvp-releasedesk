import { describe, expect, it } from "vitest";
import { buildSpaceXaiComplianceSnapshot, SPACEXAI_REQUIRED_NHI_SLOTS } from "./spacexai-compliance";

describe("buildSpaceXaiComplianceSnapshot", () => {
  it("reports all 8 exclusive slots missing and MOCK chips without keys", () => {
    const snap = buildSpaceXaiComplianceSnapshot({
      XAI_API_KEY: "shared-ignored",
      CURSOR_API_KEY: "shared-ignored",
    });
    expect(SPACEXAI_REQUIRED_NHI_SLOTS).toHaveLength(8);
    expect(snap.nhiSlots.presentCount).toBe(0);
    expect(snap.nhiSlots.missing).toHaveLength(8);
    expect(snap.chips.grokApi).toBe("MOCK");
    expect(snap.chips.cursorCloud).toBe("MOCK");
    expect(snap.compliancePct).toBe(92);
    expect(snap.credentials.every((c) => c.usedSharedFallback === false)).toBe(true);
  });

  it("raises compliance when exclusive keys + real cloud client present", () => {
    const snap = buildSpaceXaiComplianceSnapshot({
      RELEASEDESK_GROK_API_KEY_LEAD: "x",
      RELEASEDESK_GROK_API_KEY_CHANGE_ANALYST: "x",
      RELEASEDESK_GROK_API_KEY_STANDARDS: "x",
      RELEASEDESK_GROK_API_KEY_SECURITY: "x",
      RELEASEDESK_GROK_API_KEY_BUILDER: "x",
      RELEASEDESK_CURSOR_API_KEY_CODING: "x",
      RELEASEDESK_CURSOR_API_KEY_TESTING: "x",
      RELEASEDESK_CURSOR_API_KEY_REVIEW: "x",
      RELEASEDESK_CLOUD_CLIENT: "real",
    });
    expect(snap.nhiSlots.presentCount).toBe(8);
    expect(snap.nhiSlots.missing).toEqual([]);
    expect(snap.chips.grokApi).toBe("LIVE");
    expect(snap.chips.cursorCloud).toBe("LIVE");
    expect(snap.compliancePct).toBe(100);
  });
});
