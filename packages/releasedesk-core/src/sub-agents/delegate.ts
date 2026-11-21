import { catalogEntry } from "./catalog.js";
import {
  SubAgentAggregateSchema,
  SubAgentChildResultSchema,
  type ParentBotId,
  type SubAgentAggregate,
  type SubAgentChildResult,
  type SubAgentChildStatus,
} from "./schema.js";

export class SubAgentTimeoutError extends Error {
  readonly code = "sub_agent_timeout" as const;
  readonly childId: string;
  readonly timeoutMs: number;

  constructor(childId: string, timeoutMs: number) {
    super(`${childId} exceeded ${timeoutMs}ms`);
    this.name = "SubAgentTimeoutError";
    this.childId = childId;
    this.timeoutMs = timeoutMs;
  }
}

export type SubAgentChildOutcome = {
  summary: string;
  payload?: Record<string, unknown>;
};

export type SubAgentChildRun<TContext> = (
  context: TContext,
  prior: readonly SubAgentChildResult[],
) => Promise<SubAgentChildOutcome>;

export type SubAgentChildSpec<TContext> = {
  id: string;
  parentId: ParentBotId;
  responsibility: string;
  required: boolean;
  parallelGroup: number;
  timeoutMs: number;
  run: SubAgentChildRun<TContext>;
};

export type SubAgentHooks<TContext> = {
  timeoutMs?: number;
  /** Per-child budget. Wins over `timeoutMs` and the catalog default. */
  timeoutMsById?: Record<string, number>;
  runOverrides?: Record<string, SubAgentChildRun<TContext>>;
};

export function bindChild<TContext>(
  parentId: ParentBotId,
  id: string,
  run: SubAgentChildRun<TContext>,
  hooks?: SubAgentHooks<TContext>,
): SubAgentChildSpec<TContext> {
  const entry = catalogEntry(parentId, id);
  return {
    id: entry.id,
    parentId,
    responsibility: entry.responsibility,
    required: entry.required,
    parallelGroup: entry.parallelGroup,
    timeoutMs: hooks?.timeoutMsById?.[id] ?? hooks?.timeoutMs ?? entry.timeoutMs,
    run: hooks?.runOverrides?.[id] ?? run,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, childId: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new SubAgentTimeoutError(childId, timeoutMs));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function childResult(input: {
  spec: {
    id: string;
    parentId: ParentBotId;
    responsibility: string;
    required: boolean;
    parallelGroup: number;
  };
  status: SubAgentChildStatus;
  summary: string;
  payload: Record<string, unknown>;
  durationMs: number;
  error?: string;
}): SubAgentChildResult {
  return SubAgentChildResultSchema.parse({
    id: input.spec.id,
    parentId: input.spec.parentId,
    responsibility: input.spec.responsibility,
    status: input.status,
    summary: input.summary,
    payload: input.payload,
    durationMs: input.durationMs,
    required: input.spec.required,
    parallelGroup: input.spec.parallelGroup,
    ...(input.error !== undefined ? { error: input.error } : {}),
  });
}

async function runOne<TContext>(
  spec: SubAgentChildSpec<TContext>,
  context: TContext,
  prior: readonly SubAgentChildResult[],
  now: () => number,
): Promise<SubAgentChildResult> {
  const started = now();
  const elapsed = () => Math.max(0, Math.round(now() - started));
  try {
    const outcome = await withTimeout(
      Promise.resolve().then(() => spec.run(context, prior)),
      spec.timeoutMs,
      spec.id,
    );
    const summary = outcome.summary.trim();
    return childResult({
      spec,
      status: "completed",
      summary: summary.length > 0 ? summary : `${spec.id} completed`,
      payload: outcome.payload ?? {},
      durationMs: elapsed(),
    });
  } catch (err) {
    const timedOut = err instanceof SubAgentTimeoutError;
    const message = errorMessage(err);
    return childResult({
      spec,
      status: timedOut ? "timed_out" : "failed",
      summary: timedOut
        ? `${spec.id} timed out after ${spec.timeoutMs}ms`
        : `${spec.id} failed: ${message}`,
      payload: {},
      durationMs: elapsed(),
      error: message,
    });
  }
}

function isSecurityBreak(parentId: ParentBotId, child: SubAgentChildResult): boolean {
  if (parentId !== "security") return false;
  if (child.status === "failed" || child.status === "timed_out") return true;
  return child.required && child.status === "skipped";
}

/**
 * Roll child results into one parent aggregate.
 *
 * - A required child that failed or timed out fails the parent.
 * - Security fails closed on any failed, timed-out, or skipped required child.
 *   That sets `securityGateHeld` and does not approve the iteration gate.
 * - Optional failures on other parents yield `partial` when every required child completed.
 * - `skipped` on a non-security child does not by itself fail the parent.
 */
export function rollupSubAgentResults(
  parentId: ParentBotId,
  children: readonly SubAgentChildResult[],
): SubAgentAggregate {
  const completedIds = children.filter((c) => c.status === "completed").map((c) => c.id);
  const failedIds = children.filter((c) => c.status === "failed").map((c) => c.id);
  const timedOutIds = children.filter((c) => c.status === "timed_out").map((c) => c.id);
  const skippedIds = children.filter((c) => c.status === "skipped").map((c) => c.id);

  const requiredBroken = children.filter(
    (child) => child.required && (child.status === "failed" || child.status === "timed_out"),
  );
  const optionalBroken = children.filter(
    (child) => !child.required && (child.status === "failed" || child.status === "timed_out"),
  );
  const securityGateHeld = children.some((child) => isSecurityBreak(parentId, child));

  let status: SubAgentAggregate["status"];
  if (requiredBroken.length > 0 || securityGateHeld) status = "failed";
  else if (optionalBroken.length > 0 || skippedIds.length > 0) status = "partial";
  else status = "completed";

  const summary =
    children.length === 0
      ? `${parentId} delegated no child sub-agents`
      : status === "completed"
        ? `${parentId} aggregated ${completedIds.length} child sub-agent(s)`
        : status === "partial"
          ? `${parentId} aggregated with partial child results`
          : `${parentId} child sub-agents failed closed (${[...failedIds, ...timedOutIds, ...skippedIds].join(", ")})`;

  return SubAgentAggregateSchema.parse({
    parentId,
    status,
    children: [...children],
    completedIds,
    failedIds,
    timedOutIds,
    skippedIds,
    securityGateHeld,
    summary,
  });
}

/**
 * Run child slices. Children that share a parallelGroup run together.
 * Groups run in ascending order so a later slice can read earlier payloads.
 */
export async function delegateToChildren<TContext>(args: {
  parentId: ParentBotId;
  context: TContext;
  children: readonly SubAgentChildSpec<TContext>[];
  now?: () => number;
}): Promise<SubAgentAggregate> {
  const now = args.now ?? Date.now;
  for (const child of args.children) {
    if (child.parentId !== args.parentId) {
      throw new Error(
        `Sub-agent ${child.id} belongs to ${child.parentId}, not ${args.parentId}`,
      );
    }
  }

  const groups = [...new Set(args.children.map((child) => child.parallelGroup))].sort(
    (a, b) => a - b,
  );
  const results: SubAgentChildResult[] = [];
  for (const group of groups) {
    const specs = args.children.filter((child) => child.parallelGroup === group);
    const prior = results.slice();
    const settled = await Promise.all(specs.map((spec) => runOne(spec, args.context, prior, now)));
    results.push(...settled);
  }
  return rollupSubAgentResults(args.parentId, results);
}

/** Combine phased delegations (Lead front wave, then release aggregation). */
export function mergeSubAgentAggregates(
  parentId: ParentBotId,
  parts: readonly SubAgentAggregate[],
): SubAgentAggregate {
  return rollupSubAgentResults(
    parentId,
    parts.flatMap((part) => part.children),
  );
}

export function findChildResult(
  aggregate: SubAgentAggregate,
  id: string,
): SubAgentChildResult | undefined {
  return aggregate.children.find((child) => child.id === id);
}
