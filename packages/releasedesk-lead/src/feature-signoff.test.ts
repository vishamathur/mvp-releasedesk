import { describe, expect, it } from "vitest";
import { type TaskRecord } from "@releasedesk/core";
import {
  createChecklistsForFeatures,
  detectNewFeaturesFromTasks,
  getIncompleteChecklists,
} from "./feature-signoff.js";

describe("feature detection from Builder / coding work", () => {
  it("detects features from completed coding work items", () => {
    const task = {
      id: "task_b1",
      runId: "run_1",
      name: "Builder",
      agentRole: "builder",
      status: "completed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.000Z",
      dependsOn: [],
      evidence: [],
      retry: { attempt: 1, maxAttempts: 2 },
      output: {
        workItems: [
          {
            kind: "coding",
            status: "completed",
            branch: "cursor/ai-feature-1",
            prUrl: "https://github.com/org/repo/pull/1",
            notes: "Added KYC retention labels",
          },
          { kind: "testing", status: "completed", branch: "cursor/ai-feature-1" },
        ],
      },
    } as TaskRecord;
    const features = detectNewFeaturesFromTasks([task]);
    expect(features).toHaveLength(1);
    expect(features[0]!.branch).toBe("cursor/ai-feature-1");
    expect(features[0]!.sourceAgent).toBe("coding");
    const checklists = createChecklistsForFeatures(features);
    expect(checklists[0]!.kind).toBe("feature_review");
    expect(checklists[0]!.status).toBe("pending");
    expect(getIncompleteChecklists({ checklists })).toHaveLength(1);
  });
});
