import { nowIso } from "@releasedesk/core";
import type { CloudAgentHandoff } from "../builder-types.js";
import type {
  CloudAgentAuditEvent,
  CloudAgentClient,
  CloudAgentDispatchResult,
  CloudDispatchAttempt,
} from "./types.js";

export type CloudPipelineOptions = {
  client: CloudAgentClient;
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

async function dispatchWithRetry(
  client: CloudAgentClient,
  handoff: CloudAgentHandoff,
  extras: { branch?: string; prUrl?: string },
  maxAttempts: number,
  attempts: CloudDispatchAttempt[],
  auditEvents: CloudAgentAuditEvent[],
): Promise<CloudAgentDispatchResult> {
  let last: CloudAgentDispatchResult | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
        },
      });
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
      data: { willRetry },
    });
  }

  return (
    last ?? {
      handoffId: handoff.handoffId,
      agentKind: handoff.agentKind,
      status: "failed",
      mocked: client.mode === "mock",
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
 * Never auto-merges. Records audit events for every dispatch/retry/complete/fail.
 */
export async function dispatchCloudAgentPipeline(
  planned: CloudAgentHandoff[],
  options: CloudPipelineOptions,
): Promise<CloudPipelineResult> {
  const maxAttempts = options.maxAttempts ?? 2;
  const client = options.client;
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

  audit(auditEvents, {
    action: "cloud_agent.pipeline_start",
    message: `Starting Cloud Agent pipeline (${client.mode}) for branch ${proposedBranch}`,
    data: {
      mode: client.mode,
      handoffIds: handoffs.map((h) => h.handoffId),
      maxAttempts,
    },
  });

  let proposedPrUrl: string | undefined;
  let branch = proposedBranch;
  let codingOk = false;

  if (coding) {
    const codingResult = await dispatchWithRetry(
      client,
      coding,
      { branch: proposedBranch },
      maxAttempts,
      attempts,
      auditEvents,
    );
    results.push(codingResult);
    applyResultToHandoff(coding, codingResult, client.mode);
    codingOk = codingResult.status === "completed";
    if (codingResult.branch) branch = codingResult.branch;
    if (codingResult.prUrl) proposedPrUrl = codingResult.prUrl;
  }

  let testsPassed: boolean | undefined;

  if (codingOk) {
    // Testing and Review are independent after Coding completes.
    const parallel: Array<Promise<void>> = [];

    if (testing) {
      parallel.push(
        (async () => {
          const r = await dispatchWithRetry(
            client,
            testing,
            { branch, prUrl: proposedPrUrl },
            maxAttempts,
            attempts,
            auditEvents,
          );
          results.push(r);
          applyResultToHandoff(testing, r, client.mode);
          if (typeof r.testsPassed === "boolean") testsPassed = r.testsPassed;
        })(),
      );
    }

    if (review) {
      parallel.push(
        (async () => {
          const r = await dispatchWithRetry(
            client,
            review,
            { branch, prUrl: proposedPrUrl },
            maxAttempts,
            attempts,
            auditEvents,
          );
          results.push(r);
          applyResultToHandoff(review, r, client.mode);
          // Review may surface/confirm PR URL.
          if (r.prUrl && !proposedPrUrl) proposedPrUrl = r.prUrl;
        })(),
      );
    }

    await Promise.all(parallel);
  } else {
    // Skip dependents; mark as failed with clear notes.
    for (const dep of [testing, review]) {
      if (!dep) continue;
      dep.status = "failed";
      dep.metadata = {
        ...dep.metadata,
        branch,
        cloudAgentApi: client.mode,
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
