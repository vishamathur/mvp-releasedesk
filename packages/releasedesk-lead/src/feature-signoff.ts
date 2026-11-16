import {
  createFeatureArtifactId,
  createFeatureSignOffChecklist,
  nowIso,
  parseFeatureSignOffRecord,
  type FeatureArtifact,
  type FeatureSignOffChecklist,
  type FeatureSignOffRecord,
  type TaskRecord,
} from "@releasedesk/core";

export {
  allFeatureSignOffsComplete,
  getIncompleteChecklists,
  isChecklistComplete,
  parseFeatureSignOffRecord,
  signOffChecklistItem,
  signOffEntireChecklist,
  type FeatureArtifact,
  type FeatureSignOffChecklist,
  type FeatureSignOffItem,
  type FeatureSignOffItemId,
  type FeatureSignOffRecord,
} from "@releasedesk/core";

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Detect new features introduced by Builder / Cloud Coding (or explicit
 * `featuresIntroduced` payloads). Dedupes by feature id / branch+pr.
 */
export function detectNewFeaturesFromTasks(
  tasks: readonly TaskRecord[],
): FeatureArtifact[] {
  const byKey = new Map<string, FeatureArtifact>();

  for (const task of tasks) {
    if (task.agentRole !== "builder") continue;
    const out = task.output ?? {};

    const explicit = Array.isArray(out.featuresIntroduced) ? out.featuresIntroduced : [];
    for (const raw of explicit) {
      const row = asRecord(raw);
      if (!row) continue;
      const title = asString(row.title);
      const summary = asString(row.summary);
      if (!title || !summary) continue;
      const branch = asString(row.branch);
      const prUrl = asString(row.prUrl);
      const id =
        asString(row.id) ??
        createFeatureArtifactId(`${task.id}_${branch ?? title}`.replace(/\W+/g, "_"));
      const key = id;
      if (byKey.has(key)) continue;
      byKey.set(key, {
        id,
        title,
        summary,
        sourceAgent: "builder",
        taskId: task.id,
        createdAt: task.completedAt ?? task.updatedAt ?? nowIso(),
        ...(branch !== undefined ? { branch } : {}),
        ...(prUrl !== undefined ? { prUrl } : {}),
        workItemKind: "coding",
      });
    }

    const workItems = Array.isArray(out.workItems) ? out.workItems : [];
    for (const raw of workItems) {
      const wi = asRecord(raw);
      if (!wi) continue;
      if (wi.kind !== "coding") continue;
      if (wi.status !== "completed" && wi.status !== "dispatched") continue;
      const branch = asString(wi.branch) ?? asString(out.proposedBranch);
      const prUrl = asString(wi.prUrl) ?? asString(out.proposedPrUrl);
      const key = `coding:${branch ?? task.id}:${prUrl ?? ""}`;
      if (byKey.has(key)) continue;
      const title = branch
        ? `AI coding feature on ${branch}`
        : `AI coding feature from builder task ${task.id}`;
      const summary =
        asString(wi.notes) ??
        asString(out.summary) ??
        "Builder / Cloud Coding agent produced new feature code requiring human checklist sign-off.";
      byKey.set(key, {
        id: createFeatureArtifactId(key.replace(/\W+/g, "_")),
        title,
        summary,
        sourceAgent: "coding",
        taskId: task.id,
        createdAt: task.completedAt ?? task.updatedAt ?? nowIso(),
        ...(branch !== undefined ? { branch } : {}),
        ...(prUrl !== undefined ? { prUrl } : {}),
        workItemKind: "coding",
      });
    }

    const handoffs = Array.isArray(out.cloudAgentHandoffs) ? out.cloudAgentHandoffs : [];
    for (const raw of handoffs) {
      const h = asRecord(raw);
      if (!h) continue;
      if (h.agentKind !== "coding") continue;
      if (h.status !== "completed" && h.status !== "dispatched") continue;
      const meta = asRecord(h.metadata) ?? {};
      const branch =
        asString(meta.branch) ?? asString(h.proposedBranch) ?? asString(out.proposedBranch);
      const prUrl = asString(meta.prUrl) ?? asString(out.proposedPrUrl);
      const key = `handoff:${asString(h.handoffId) ?? branch ?? task.id}`;
      if ([...byKey.values()].some((f) => f.branch && branch && f.branch === branch)) continue;
      if (byKey.has(key)) continue;
      byKey.set(key, {
        id: createFeatureArtifactId(key.replace(/\W+/g, "_")),
        title: branch
          ? `Cloud Coding agent feature on ${branch}`
          : `Cloud Coding agent feature (${asString(h.handoffId) ?? task.id})`,
        summary:
          "Cursor Cloud Coding agent produced new feature code; developer checklist sign-off required.",
        sourceAgent: "coding",
        taskId: task.id,
        createdAt: task.completedAt ?? task.updatedAt ?? nowIso(),
        ...(branch !== undefined ? { branch } : {}),
        ...(prUrl !== undefined ? { prUrl } : {}),
        workItemKind: "coding",
      });
    }
  }

  return [...byKey.values()];
}

/** Create pending feature_review checklists for newly detected features. */
export function createChecklistsForFeatures(
  features: readonly FeatureArtifact[],
): FeatureSignOffChecklist[] {
  return features.map((feature) =>
    createFeatureSignOffChecklist(feature, { kind: "feature_review" }),
  );
}

export function mergeFeatureSignOffRecords(
  base: FeatureSignOffRecord | undefined,
  incoming: readonly FeatureSignOffChecklist[],
): FeatureSignOffRecord {
  const existing = parseFeatureSignOffRecord(base);
  const seen = new Set(existing.checklists.map((c) => c.feature.id));
  const merged = [...existing.checklists];
  for (const checklist of incoming) {
    if (seen.has(checklist.feature.id)) continue;
    // Also skip duplicate branches already tracked.
    if (
      checklist.feature.branch &&
      merged.some((c) => c.feature.branch === checklist.feature.branch)
    ) {
      continue;
    }
    merged.push(checklist);
    seen.add(checklist.feature.id);
  }
  return { checklists: merged };
}
