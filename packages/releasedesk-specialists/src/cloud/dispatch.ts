import { nowIso } from "@releasedesk/core";
import type { CloudAgentHandoff } from "../builder-types.js";
import {
  resolveCloudAgentClientForKind,
  type ResolveCloudAgentClientOptions,
} from "./resolve.js";
import type {
  CloudAgentAuditEvent,
  CloudAgentClient,
  CloudAgentDispatchResult,
  CloudAgentKind,
  CloudDispatchAttempt,
} from "./types.js";

export type CloudPipelineOptions = {
  /**
   * Shared client for every handoff (tests / MOCK injection).
   * When omitted, each kind resolves via `resolveClient` or
   * `resolveCloudAgentClientForKind` (exclusive per-agent Cursor keys).
   */
  client?: CloudAgentClient;
  /** Optional factory — wins over env-based per-kind resolve. */
  resolveClient?: (agentKind: CloudAgentKind) => CloudAgentClient;
  /** Env/mode options used when resolving per-kind real clients. */
  resolve?: ResolveCloudAgentClientOptions;
  /** Per-handoff retry budget (total attempts). Default 2. */
  maxAttempts?: number;
};

export type CloudPipelineResult = {
  handoffs: CloudAgentHandoff[];
  results: CloudAgentDispatchResult[];
  attempts: CloudDispatchAttempt[];
  audit: CloudAgentAuditEvent[];
  proposedBranch: string;
  proposedPrUrl?: string;
  testsPassed?: boolean;
  codingOk: boolean;
  allOk: boolean;
};

function audit(
  events: CloudAgentAuditEvent[],
  partial: Omit<CloudAgentAuditEvent, "at">,
): void {
  events.push({ at: nowIso(), ...partial });
}

function clientForKind(
  agentKind: CloudAgentKind,
  options: CloudPipelineOptions,
): CloudAgentClient {
  if (options.resolveClient) {
    return options.resolveClient(agentKind);
  }
  if (options.client) {
    return options.client;
  }
  return resolveCloudAgentClientForKind(agentKind, options.resolve ?? {});
}

async function dispatchWithRetry(
  getClient: (agentKind: CloudAgentKind) => CloudAgentClient,
  handoff: CloudAgentHandoff,
  extras: { branch?: string; prUrl?: string },
  maxAttempts: number,
  attempts: CloudDispatchAttempt[],
  auditEvents: CloudAgentAuditEvent[],
): Promise<CloudAgentDispatchResult> {
  let last: CloudAgentDispatchResult | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = getClient(handoff.agentKind);

    audit(auditEvents, {
      action: "cloud_agent.dispatch",
      handoffId: handoff.handoffId,
      agentKind: handoff.agentKind,
      attempt,
      message: `Dispatching ${handoff.agentKind} Cloud Agent (attempt ${attempt}/${maxAttempts})`,
      data: { mode: client.mode, branch: extras.branch ?? handoff.proposedBranch },
    });

    handoff.status = "dispatched";

    const result = await client.dispatch({
      handoffId: handoff.handoffId,
      agentKind: handoff.agentKind,
      prompt: handoff.prompt,
      repository: handoff.repository,
      baseBranch: handoff.baseBranch,
      proposedBranch: handoff.proposedBranch,
      acceptanceCriteria: handoff.acceptanceCriteria,
      branch: extras.branch ?? handoff.proposedBranch,
      prUrl: extras.prUrl,
      autoMerge: false,
    });

    last = result;

    if (result.status === "completed") {
      attempts.push({
        handoffId: handoff.handoffId,
        agentKind: handoff.agentKind,
        attempt,
        outcome: "completed",
        result,
      });
      audit(auditEvents, {
        action: "cloud_agent.completed",
        handoffId: handoff.handoffId,
        agentKind: handoff.agentKind,
        attempt,
        message: result.summary,
        data: {
          branch: result.branch,
          prUrl: result.prUrl,
          testsPassed: result.testsPassed,
          cloudAgentUrl: result.cloudAgentUrl,
          mocked: result.mocked,
          mode: client.mode,
        },
      });
      applyResultToHandoff(handoff, result, client.mode);
      return result;
    }

    const willRetry = attempt < maxAttempts;
    attempts.push({
      handoffId: handoff.handoffId,
      agentKind: handoff.agentKind,
      attempt,
      outcome: willRetry ? "retrying" : "failed",
      error: result.error,
      result,
    });
    audit(auditEvents, {
      action: willRetry ? "cloud_agent.retrying" : "cloud_agent.failed",
      handoffId: handoff.handoffId,
      agentKind: handoff.agentKind,
      attempt,
      message: result.error ?? result.summary,
      data: { willRetry, mode: client.mode },
    });

    if (!willRetry) {
      applyResultToHandoff(handoff, result, client.mode);
    }
  }

  return (
    last ?? {
      handoffId: handoff.handoffId,
      agentKind: handoff.agentKind,
      status: "failed",
      mocked: true,
      summary: `No dispatch result for ${handoff.agentKind}`,
      attempt: maxAttempts,
      error: "empty dispatch",
    }
  );
}

function applyResultToHandoff(
  handoff: CloudAgentHandoff,
  result: CloudAgentDispatchResult,
  clientMode: CloudAgentClient["mode"],
): void {
  handoff.status = result.status === "completed" ? "completed" : "failed";
  handoff.metadata = {
    ...handoff.metadata,
    branch: result.branch ?? handoff.metadata.branch,
    testsPassed: result.testsPassed ?? handoff.metadata.testsPassed,
    prUrl: result.prUrl ?? handoff.metadata.prUrl,
    cloudAgentApi: clientMode,
    cloudAgentId: result.cloudAgentId,
    cloudRunId: result.cloudRunId,
    cloudAgentUrl: result.cloudAgentUrl,
    dispatchAttempt: result.attempt,
    error: result.error,
  };
}

/**
 * Builder → Cloud Agents pipeline:
 * 1. Coding (sequential, with retries)
 * 2. Testing + Review in parallel after Coding succeeds
 *
 * Each agent kind resolves its own Cursor API key via
 * `resolveCloudAgentClientForKind` unless a shared `client` / `resolveClient`
 * is injected.
 *
 * Never auto-merges. Records audit events for every dispatch/retry/complete/fail.
 */
export async function dispatchCloudAgentPipeline(
  planned: CloudAgentHandoff[],
  options: CloudPipelineOptions,
): Promise<CloudPipelineResult> {
  const pipelineOptions: CloudPipelineOptions =
    options.client || options.resolveClient || options.resolve !== undefined
      ? options
      : { ...options, resolve: {} };

  const maxAttempts = pipelineOptions.maxAttempts ?? 2;
  const getClient = (agentKind: CloudAgentKind) =>
    clientForKind(agentKind, pipelineOptions);
  const handoffs = planned.map((h) => ({
    ...h,
    metadata: { ...h.metadata },
    acceptanceCriteria: [...h.acceptanceCriteria],
    relatedEvidenceIds: [...h.relatedEvidenceIds],
  }));
  const results: CloudAgentDispatchResult[] = [];
  const attempts: CloudDispatchAttempt[] = [];
  const auditEvents: CloudAgentAuditEvent[] = [];

  const coding = handoffs.find((h) => h.agentKind === "coding");
  const testing = handoffs.find((h) => h.agentKind === "testing");
  const review = handoffs.find((h) => h.agentKind === "review");

  const proposedBranch = coding?.proposedBranch ?? handoffs[0]?.proposedBranch ?? "unknown";
  const pipelineModeHint = pipelineOptions.client?.mode ?? "per-agent-resolve";

  audit(auditEvents, {
    action: "cloud_agent.pipeline_start",
    message: `Starting Cloud Agent pipeline (${pipelineModeHint}) for branch ${proposedBranch}`,
    data: {
      mode: pipelineModeHint,
      handoffIds: handoffs.map((h) => h.handoffId),
      maxAttempts,
      perAgentKeys: !pipelineOptions.client,
    },
  });

  let proposedPrUrl: string | undefined;
  let branch = proposedBranch;
  let codingOk = false;

  if (coding) {
    const codingResult = await dispatchWithRetry(
      getClient,
      coding,
      { branch: proposedBranch },
      maxAttempts,
      attempts,
      auditEvents,
    );
    results.push(codingResult);
    codingOk = codingResult.status === "completed";
    if (codingResult.branch) branch = codingResult.branch;
    if (codingResult.prUrl) proposedPrUrl = codingResult.prUrl;
  }

  let testsPassed: boolean | undefined;

  if (codingOk) {
    const parallel: Array<Promise<void>> = [];

    if (testing) {
      parallel.push(
        (async () => {
          const r = await dispatchWithRetry(
            getClient,
            testing,
            { branch, prUrl: proposedPrUrl },
            maxAttempts,
            attempts,
            auditEvents,
          );
          results.push(r);
          if (typeof r.testsPassed === "boolean") testsPassed = r.testsPassed;
        })(),
      );
    }

    if (review) {
      parallel.push(
        (async () => {
          const r = await dispatchWithRetry(
            getClient,
            review,
            { branch, prUrl: proposedPrUrl },
            maxAttempts,
            attempts,
            auditEvents,
          );
          results.push(r);
          if (r.prUrl && !proposedPrUrl) proposedPrUrl = r.prUrl;
        })(),
      );
    }

    await Promise.all(parallel);
  } else {
    for (const dep of [testing, review]) {
      if (!dep) continue;
      dep.status = "failed";
      dep.metadata = {
        ...dep.metadata,
        branch,
        cloudAgentApi: pipelineOptions.client?.mode ?? "mock",
        error: "Skipped because Coding Agent did not complete",
      };
      audit(auditEvents, {
        action: "cloud_agent.skipped",
        handoffId: dep.handoffId,
        agentKind: dep.agentKind,
        message: `Skipped ${dep.agentKind}: Coding Agent failed`,
      });
    }
  }

  const allOk =
    codingOk &&
    handoffs
      .filter((h) => h.agentKind === "testing" || h.agentKind === "review")
      .every((h) => h.status === "completed");

  audit(auditEvents, {
    action: "cloud_agent.pipeline_end",
    message: allOk
      ? `Cloud Agent pipeline completed for ${branch}`
      : `Cloud Agent pipeline finished with failures for ${branch}`,
    data: {
      codingOk,
      allOk,
      proposedBranch: branch,
      proposedPrUrl,
      testsPassed,
      autoMerge: false,
    },
  });

  return {
    handoffs,
    results,
    attempts,
    audit: auditEvents,
    proposedBranch: branch,
    proposedPrUrl,
    testsPassed,
    codingOk,
    allOk,
  };
}
