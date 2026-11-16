import type { RunContext } from "./run-context.js";
import type { TaskRecord } from "./task.js";

/**
 * Token efficiency for ITS margin (every token is a client invoice line item).
 * Prefer role-scoped context slices over shipping the full durable run.
 */

export const CHARS_PER_TOKEN = 4;

export type RoleContextSlice = {
  role: string;
  goal: string;
  target: RunContext["target"];
  taskId?: string;
  taskInput?: Record<string, unknown>;
  peerSummaries: Array<{ role: string; status: string; summary: string }>;
  openBlockingHints: string[];
  latestCheckpoint?: { stage: string; status: string; summary?: string };
  evidenceIds: string[];
};

export type TokenBudgetComparison = {
  fullRunChars: number;
  fullRunTokensEst: number;
  sliceChars: number;
  sliceTokensEst: number;
  savingsTokensEst: number;
  savingsPct: number;
};

export function estimateTokensFromText(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateTokensFromJson(value: unknown): number {
  return estimateTokensFromText(JSON.stringify(value));
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Build a lean per-role slice for agent prompts — not the full RunContext.
 */
export function buildRoleContextSlice(
  run: RunContext,
  role: string,
  opts?: {
    task?: TaskRecord;
    summaryMaxChars?: number;
    openBlockingHints?: string[];
    latestCheckpoint?: RoleContextSlice["latestCheckpoint"];
  },
): RoleContextSlice {
  const summaryMax = opts?.summaryMaxChars ?? 240;
  const task = opts?.task ?? run.tasks.find((t) => t.agentRole === role);

  const peerSummaries = run.tasks
    .filter((t) => t.agentRole !== "lead" && t.agentRole !== role)
    .map((t) => ({
      role: t.agentRole,
      status: t.status,
      summary: truncate(
        typeof t.output?.summary === "string"
          ? t.output.summary
          : t.name,
        summaryMax,
      ),
    }));

  const evidenceIds = (task?.evidence ?? []).map((e) => e.id);

  return {
    role,
    goal: run.goal,
    target: run.target,
    ...(task ? { taskId: task.id } : {}),
    ...(task?.input ? { taskInput: task.input } : {}),
    peerSummaries,
    openBlockingHints: opts?.openBlockingHints ?? [],
    ...(opts?.latestCheckpoint ? { latestCheckpoint: opts.latestCheckpoint } : {}),
    evidenceIds,
  };
}

/** Compare full-run packing vs role slice (token ≈ chars/4). */
export function compareFullRunVsSlice(
  run: RunContext,
  slice: RoleContextSlice,
): TokenBudgetComparison {
  const fullRunChars = JSON.stringify(run).length;
  const sliceChars = JSON.stringify(slice).length;
  const fullRunTokensEst = Math.ceil(fullRunChars / CHARS_PER_TOKEN);
  const sliceTokensEst = Math.ceil(sliceChars / CHARS_PER_TOKEN);
  const savingsTokensEst = Math.max(0, fullRunTokensEst - sliceTokensEst);
  const savingsPct =
    fullRunTokensEst === 0
      ? 0
      : Math.round((savingsTokensEst / fullRunTokensEst) * 1000) / 10;
  return {
    fullRunChars,
    fullRunTokensEst,
    sliceChars,
    sliceTokensEst,
    savingsTokensEst,
    savingsPct,
  };
}
