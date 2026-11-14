import { readFile } from "node:fs/promises";
import {
  createMockMeta,
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function createChangeAnalystRunner(options: SpecialistRunnerOptions = {}): AgentRunner {
  return async (inv: AgentRunInvocation): Promise<AgentRunResult> => {
    const workspaceRoot = options.workspaceRoot ?? defaultWorkspaceRoot();
    const input = inv.task.input ?? {};
    const repository =
      asString(input.repository) ?? inv.run.target.repository ?? "unknown/repo";
    const baseRef =
      asString(input.baseRef) ?? inv.run.target.baseRef ?? "main";
    const headRef =
      asString(input.headRef) ?? inv.run.target.headRef ?? "HEAD";
    const focusPaths = asStringArray(input.focusPaths);

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

      // Synthesize findings from focus paths / known layout when git is empty.
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

    let releaseNotesDraft = localNotes;
    if (!options.skipGrok) {
      const grok = await grokComplete(
        `Draft concise release notes for ${repository} (${baseRef}...${headRef}). Findings JSON: ${JSON.stringify(findings.slice(0, 30))}`,
        {
          ...options.grok,
          fallback: localNotes,
        },
      );
      if (grok.mocked && grok.mock) mocksUsed.push(grok.mock);
      // Prefer local structured draft; append Grok narrative only when live.
      if (!grok.mocked) {
        releaseNotesDraft = `${localNotes}\n\n### Grok narrative\n${grok.text}`;
      } else {
        releaseNotesDraft = localNotes;
      }
    }

    const summary =
      diff.source === "git"
        ? `Change analysis complete: ${findings.length} path(s), impact ${overallImpact}`
        : formatMockNote(
            `Change analysis complete via fixtures/synthesis: ${findings.length} path(s), impact ${overallImpact}`,
          );

    const payload = ChangeAnalystOutputSchema.parse({
      runId: inv.runId,
      taskId: inv.taskId,
      agentRole: "change_analyst",
      status: "completed",
      completedAt: nowIso(),
      summary,
      evidence: [],
      mocksUsed,
      releaseNotesDraft,
      findings,
      overallImpact,
      commitsReviewed,
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
      },
      evidence,
      mocksUsed,
    };
  };
}
