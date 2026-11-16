import { describe, expect, it } from "vitest";
import {
  allFeatureSignOffsComplete,
  createFeatureArtifactId,
  createFeatureSignOffChecklist,
  DEFAULT_FEATURE_SIGNOFF_ITEM_DEFS,
  deriveChecklistStatus,
  getIncompleteChecklists,
  isChecklistComplete,
  parseFeatureSignOffRecord,
  signOffChecklistItem,
  signOffEntireChecklist,
} from "./feature-signoff.js";
import { nowIso } from "./ids.js";

describe("feature sign-off checklist contracts", () => {
  const feature = {
    id: createFeatureArtifactId("test"),
    title: "Add retention label",
    summary: "AI coding agent added retention labels to KYC uploads",
    sourceAgent: "builder" as const,
    taskId: "task_1",
    branch: "cursor/retention-8f1e",
    createdAt: nowIso(),
  };

  it("creates a pending checklist with all default items unsigned", () => {
    const checklist = createFeatureSignOffChecklist(feature);
    expect(checklist.kind).toBe("feature_review");
    expect(checklist.status).toBe("pending");
    expect(checklist.items).toHaveLength(DEFAULT_FEATURE_SIGNOFF_ITEM_DEFS.length);
    expect(checklist.items.every((i) => i.signedOff === false)).toBe(true);
    expect(isChecklistComplete(checklist)).toBe(false);
  });

  it("partial sign-off moves status to in_progress and remains incomplete", () => {
    const checklist = createFeatureSignOffChecklist(feature);
    const partial = signOffChecklistItem(checklist, "intent_match", {
      signedOffBy: "dev@northwind",
    });
    expect(partial.status).toBe("in_progress");
    expect(partial.items.find((i) => i.id === "intent_match")?.signedOff).toBe(true);
    expect(isChecklistComplete(partial)).toBe(false);
    expect(deriveChecklistStatus(partial.items)).toBe("in_progress");
  });

  it("full item-by-item sign-off completes the checklist", () => {
    let next = createFeatureSignOffChecklist(feature);
    for (const def of DEFAULT_FEATURE_SIGNOFF_ITEM_DEFS) {
      next = signOffChecklistItem(next, def.id, { signedOffBy: "dev@northwind" });
    }
    expect(next.status).toBe("completed");
    expect(isChecklistComplete(next)).toBe(true);
    expect(next.completedBy).toBe("dev@northwind");
    expect(next.completedAt).toBeTruthy();
  });

  it("signOffEntireChecklist completes all remaining items", () => {
    const checklist = createFeatureSignOffChecklist(feature);
    const done = signOffEntireChecklist(checklist, { signedOffBy: "dev@northwind" });
    expect(done.status).toBe("completed");
    expect(allFeatureSignOffsComplete({ checklists: [done] })).toBe(true);
  });

  it("getIncompleteChecklists / allFeatureSignOffsComplete edge cases", () => {
    expect(allFeatureSignOffsComplete(undefined)).toBe(true);
    expect(allFeatureSignOffsComplete({ checklists: [] })).toBe(true);
    const pending = createFeatureSignOffChecklist(feature);
    expect(getIncompleteChecklists({ checklists: [pending] })).toHaveLength(1);
    expect(allFeatureSignOffsComplete({ checklists: [pending] })).toBe(false);
  });

  it("parseFeatureSignOffRecord tolerates empty / invalid input", () => {
    expect(parseFeatureSignOffRecord(null)).toEqual({ checklists: [] });
    expect(parseFeatureSignOffRecord({ checklists: [] }).checklists).toEqual([]);
  });

  it("rejects double sign-off of the same item", () => {
    const checklist = createFeatureSignOffChecklist(feature);
    const once = signOffChecklistItem(checklist, "no_secrets", { signedOffBy: "dev" });
    expect(() => signOffChecklistItem(once, "no_secrets", { signedOffBy: "dev" })).toThrow(
      /already signed off/,
    );
  });
});
