import { formatMockNote, nowIso, type TaskRecord } from "@releasedesk/core";
import { latestTasksByRole } from "./readiness.js";

/**
 * Consolidated release notes package — turns Change Analyst drafts into a
 * first-class, human-reviewable artifact on the run (working software > docs).
 */

export type ReleaseNotesHighlight = {
  path: string;
  changeType: string;
  impact: string;
  summary: string;
};

export type ReleaseNotesPackage = {
  id: string;
  status: "draft" | "ready_for_review";
  generatedAt: string;
  title: string;
  repository: string;
  baseRef: string;
  headRef: string;
  overallImpact: "low" | "medium" | "high" | "unknown";
  commitsReviewed: number;
  bodyMarkdown: string;
  highlights: ReleaseNotesHighlight[];
  sourceTaskId?: string;
  mocked: boolean;
};

export type ReleaseNotesRecord = {
  packages: ReleaseNotesPackage[];
};

let releaseNotesSeq = 0;

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asImpact(value: unknown): ReleaseNotesPackage["overallImpact"] {
  if (value === "low" || value === "medium" || value === "high" || value === "unknown") {
    return value;
  }
  return "unknown";
}

export function parseReleaseNotesRecord(raw: unknown): ReleaseNotesRecord {
  if (!raw || typeof raw !== "object") return { packages: [] };
  const packages = (raw as { packages?: ReleaseNotesPackage[] }).packages;
  return { packages: Array.isArray(packages) ? packages : [] };
}

export function latestReleaseNotes(
  record: ReleaseNotesRecord | undefined,
): ReleaseNotesPackage | undefined {
  const packages = record?.packages ?? [];
  return packages[packages.length - 1];
}

export function buildReleaseNotesPackage(input: {
  tasks: readonly TaskRecord[];
  repository: string;
  baseRef?: string;
  headRef?: string;
  goal?: string;
}): ReleaseNotesPackage {
  releaseNotesSeq += 1;
  const latest = latestTasksByRole(input.tasks);
  const analyst = latest.find((t) => t.agentRole === "change_analyst");
  const baseRef = input.baseRef ?? "main";
  const headRef = input.headRef ?? "HEAD";
  const out = analyst?.output ?? {};

  const draft = asString(out.releaseNotesDraft);
  const overallImpact = asImpact(out.overallImpact);
  const commitsReviewed = asNumber(out.commitsReviewed) ?? 0;
  const findings = Array.isArray(out.findings) ? out.findings : [];

  const highlights: ReleaseNotesHighlight[] = findings
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
    .slice(0, 25)
    .map((f) => ({
      path: asString(f.path) ?? "unknown",
      changeType: asString(f.changeType) ?? "unknown",
      impact: asString(f.impact) ?? "unknown",
      summary: asString(f.summary) ?? "",
    }));

  const mocked =
    !draft ||
    draft.startsWith("MOCK:") ||
    highlights.some((h) => h.summary.startsWith("MOCK:")) ||
    analyst?.status !== "completed";

  const title =
    input.goal && input.goal.trim().length > 0
      ? `Release notes — ${input.goal}`
      : `Release notes — ${input.repository}`;

  const bodyMarkdown =
    draft && draft.trim().length > 0
      ? draft
      : [
          `## ${title}`,
          "",
          formatMockNote("No Change Analyst draft available; synthesized empty package."),
          "",
          `Range: \`${baseRef}...${headRef}\``,
        ].join("\n");

  return {
    id: `release_notes_${releaseNotesSeq}_${Date.now()}`,
    status: analyst?.status === "completed" ? "ready_for_review" : "draft",
    generatedAt: nowIso(),
    title,
    repository: input.repository,
    baseRef,
    headRef,
    overallImpact,
    commitsReviewed,
    bodyMarkdown,
    highlights,
    ...(analyst ? { sourceTaskId: analyst.id } : {}),
    mocked,
  };
}
