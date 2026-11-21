import { readFile } from "node:fs/promises";
import {
  bindChild,
  createMockMeta,
  delegateToChildren,
  formatMockNote,
  nowIso,
  ChangeAnalystOutputSchema,
  type CreateEvidenceInput,
  type MockMeta,
} from "@releasedesk/core";
import type { AgentRunner, AgentRunInvocation, AgentRunResult } from "@releasedesk/lead";
import {
  collectLocalDiff,
  impactForPath,
  mapChangeType,
  overallImpactFromFindings,
} from "./git-diff.js";
import { grokComplete } from "./grok.js";
import type { SpecialistRunnerOptions } from "./options.js";
import { defaultWorkspaceRoot, releaseNotesFixturePath } from "./paths.js";
import { failedSubAgentResult, subAgentHooks } from "./sub-agent-hooks.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

type ChangeFindingDraft = {
  path: string;
  changeType: "added" | "modified" | "deleted" | "renamed" | "unknown";
  impact: "low" | "medium" | "high" | "unknown";
  summary: string;
};

type DiffImpactSlice = {
  findings: ChangeFindingDraft[];
  overallImpact: "low" | "medium" | "high" | "unknown";
  commitsReviewed: number;
  localNotes: string;
  summary: string;
  evidence: CreateEvidenceInput[];
  mocksUsed: MockMeta[];
};

function readRefs(inv: AgentRunInvocation): {
  repository: string;
  baseRef: string;
  headRef: string;
  focusPaths: string[];
} {
  const input = inv.task.input ?? {};
  return {
    repository: asString(input.repository) ?? inv.run.target.repository ?? "unknown/repo",
    baseRef: asString(input.baseRef) ?? inv.run.target.baseRef ?? "main",
    headRef: asString(input.headRef) ?? inv.run.target.headRef ?? "HEAD",
    focusPaths: asStringArray(input.focusPaths),
  };
}

/** Diff and impact slice. Same evidence and findings the parent returned before delegation. */
async function analyzeDiffImpact(
  inv: AgentRunInvocation,
  options: SpecialistRunnerOptions,
): Promise<DiffImpactSlice> {
  const workspaceRoot = options.workspaceRoot ?? defaultWorkspaceRoot();
  const { repository, baseRef, headRef, focusPaths } = readRefs(inv);

  const mocksUsed: MockMeta[] = [];
  const evidence: CreateEvidenceInput[] = [];

  let diff = await collectLocalDiff({ cwd: workspaceRoot, baseRef, headRef });
  mocksUsed.push(...diff.mocksUsed);

  let usedFixtureNotes = false;
  if (diff.files.length === 0) {
    usedFixtureNotes = true;
    const notesPath = options.releaseNotesPath ?? releaseNotesFixturePath();
    let fixtureBody = "";
    try {
      fixtureBody = await readFile(notesPath, "utf8");
    } catch {
      fixtureBody = "Fixture release notes unavailable.";
    }
    const mock = createMockMeta(
      "release-notes-fixture",
      "No git name-status entries; loaded sample release notes fixture",
    );
    mocksUsed.push(mock);
    evidence.push({
      kind: "artifact",
      title: "Sample release notes fixture",
      summary: formatMockNote("Loaded fixtures/release-notes/sample-release-notes.md"),
      source: "change_analyst",
      uri: notesPath,
      mock,
      data: { preview: fixtureBody.slice(0, 500) },
    });

    const syntheticPaths =
      focusPaths.length > 0
        ? focusPaths
        : ["apps/kyc", "packages/releasedesk-core", "packages/releasedesk-lead"];
    diff = {
      ...diff,
      files: syntheticPaths.map((p) => ({ status: "M" as const, path: p })),
      source: "fixture",
      mocked: true,
    };
  }

  const findings = diff.files
    .filter((f) => {
      if (focusPaths.length === 0) return true;
      return focusPaths.some((fp) => f.path.startsWith(fp) || (f.newPath?.startsWith(fp) ?? false));
    })
    .map((f) => {
      const path = f.newPath ?? f.path;
      const impact = impactForPath(path);
      return {
        path,
        changeType: mapChangeType(f.status),
        impact,
        summary:
          diff.source === "git"
            ? `${mapChangeType(f.status)} ${path} (impact ${impact})`
            : formatMockNote(`${mapChangeType(f.status)} ${path} from fixture synthesis`),
      };
    });

  const overallImpact = overallImpactFromFindings(findings.map((f) => f.impact));
  const commitsReviewed = diff.commits.length;

  evidence.push({
    kind: "diff",
    title: `Changes ${baseRef}...${headRef}`,
    summary:
      diff.source === "git"
        ? `Inspected ${findings.length} path(s), ${commitsReviewed} commit(s) via local git`
        : formatMockNote(`Fixture/synthetic change set: ${findings.length} path(s)`),
    source: "change_analyst",
    data: {
      repository,
      baseRef,
      headRef,
      files: diff.files.slice(0, 100),
      commits: diff.commits.slice(0, 50),
      source: diff.source,
    },
    ...(diff.mocked
      ? { mock: createMockMeta("git-diff", "Partial or fixture-backed change analysis") }
      : {}),
  });

  const localNotes = [
    `## Release notes draft — ${repository}`,
    "",
    `Range: \`${baseRef}...${headRef}\``,
    `Commits reviewed: ${commitsReviewed}`,
    `Overall impact: ${overallImpact}`,
    "",
    "### Notable paths",
    ...findings.slice(0, 20).map((f) => `- \`${f.path}\` (${f.changeType}, ${f.impact})`),
    "",
    commitsReviewed > 0
      ? `### Commits\n${diff.commits
          .slice(0, 15)
          .map((c) => `- ${c.sha} ${c.subject}`)
          .join("\n")}`
      : usedFixtureNotes
        ? "### Notes\nDerived from fixture release notes because git range was empty or unavailable."
        : "### Notes\nNo commits in range.",
  ].join("\n");

  const summary =
    diff.source === "git"
      ? `Change analysis complete: ${findings.length} path(s), impact ${overallImpact}`
      : formatMockNote(
          `Change analysis complete via fixtures/synthesis: ${findings.length} path(s), impact ${overallImpact}`,
        );

  return {
    findings,
    overallImpact,
    commitsReviewed,
    localNotes,
    summary,
    evidence,
    mocksUsed,
  };
}

function estimateEffort(
  impact: string,
  findingsCount: number,
): { effort: "small" | "medium" | "large"; summary: string } {
  if (impact === "high" || findingsCount > 40) {
    return {
      effort: "large",
      summary: `Estimate large (${findingsCount} path(s), impact ${impact})`,
    };
  }
  if (impact === "medium" || findingsCount > 10) {
    return {
      effort: "medium",
      summary: `Estimate medium (${findingsCount} path(s), impact ${impact})`,
    };
  }
  return {
    effort: "small",
    summary: `Estimate small (${findingsCount} path(s), impact ${impact})`,
  };
}

export function createChangeAnalystRunner(options: SpecialistRunnerOptions = {}): AgentRunner {
  const hooks = subAgentHooks(options.subAgents);
  return async (inv: AgentRunInvocation): Promise<AgentRunResult> => {
    let analysis: DiffImpactSlice | undefined;
    const aggregate = await delegateToChildren({
      parentId: "change_analyst",
      context: inv,
      children: [
        bindChild(
          "change_analyst",
          "change_analyst.er-intake",
          async () => {
            const refs = readRefs(inv);
            return {
              summary: `Intake ${refs.repository} ${refs.baseRef}...${refs.headRef}`,
              payload: { ...refs, focusCount: refs.focusPaths.length },
            };
          },
          hooks,
        ),
        bindChild(
          "change_analyst",
          "change_analyst.diff-impact",
          async () => {
            analysis = await analyzeDiffImpact(inv, options);
            return {
              summary: analysis.summary,
              payload: {
                overallImpact: analysis.overallImpact,
                findingsCount: analysis.findings.length,
                commitsReviewed: analysis.commitsReviewed,
              },
            };
          },
          hooks,
        ),
        bindChild(
          "change_analyst",
          "change_analyst.estimation",
          async (_ctx, prior) => {
            const diff = prior.find((child) => child.id === "change_analyst.diff-impact");
            const impact =
              typeof diff?.payload.overallImpact === "string" ? diff.payload.overallImpact : "unknown";
            const findingsCount =
              typeof diff?.payload.findingsCount === "number" ? diff.payload.findingsCount : 0;
            const estimate = estimateEffort(impact, findingsCount);
            return {
              summary: estimate.summary,
              payload: {
                effort: estimate.effort,
                findingsCount,
                overallImpact: impact,
              },
            };
          },
          hooks,
        ),
      ],
    });

    if (!analysis || aggregate.status === "failed") {
      return failedSubAgentResult("change_analyst", aggregate, {
        ...(analysis
          ? {
              findings: analysis.findings,
              overallImpact: analysis.overallImpact,
              commitsReviewed: analysis.commitsReviewed,
            }
          : {}),
      });
    }

    const { repository, baseRef, headRef } = readRefs(inv);
    let releaseNotesDraft = analysis.localNotes;
    const mocksUsed = [...analysis.mocksUsed];
    const evidence = [...analysis.evidence];

    if (!options.skipGrok) {
      const grok = await grokComplete(
        `Draft concise release notes for ${repository} (${baseRef}...${headRef}). Findings JSON: ${JSON.stringify(analysis.findings.slice(0, 30))}`,
        {
          ...options.grok,
          agentRole: options.grok?.agentRole ?? "change_analyst",
          fallback: analysis.localNotes,
        },
      );
      if (grok.mocked && grok.mock) mocksUsed.push(grok.mock);
      if (!grok.mocked) {
        releaseNotesDraft = `${analysis.localNotes}\n\n### Grok narrative\n${grok.text}`;
      } else {
        releaseNotesDraft = analysis.localNotes;
      }
    }

    const payload = ChangeAnalystOutputSchema.parse({
      runId: inv.runId,
      taskId: inv.taskId,
      agentRole: "change_analyst",
      status: "completed",
      completedAt: nowIso(),
      summary: analysis.summary,
      evidence: [],
      mocksUsed,
      releaseNotesDraft,
      findings: analysis.findings,
      overallImpact: analysis.overallImpact,
      commitsReviewed: analysis.commitsReviewed,
    });

    return {
      status: "completed",
      summary: payload.summary,
      payload: {
        agentRole: payload.agentRole,
        releaseNotesDraft: payload.releaseNotesDraft,
        findings: payload.findings,
        overallImpact: payload.overallImpact,
        commitsReviewed: payload.commitsReviewed,
        evidence: payload.evidence,
        mocksUsed: payload.mocksUsed,
        subAgents: aggregate,
      },
      evidence,
      mocksUsed,
    };
  };
}
