import {
  FileBackedRunContextStore,
  createInMemoryStore,
  type RunContextStore,
} from "@releasedesk/core";
import {
  LeadOrchestrator,
  type LeadOrchestratorOptions,
  type ReleaseCheckReport,
  type StartReleaseCheckInput,
} from "@releasedesk/lead";
import {
  createCloudSpecialistRunners,
  type CloudSpecialistRunnerOptions,
} from "./cloud-runners.js";
import { describeCloudClientMode, resolveCloudAgentClient } from "./resolve.js";
import type {
  CloudAgentClient,
  CloudAgentDispatchResult,
  SharedRunContextRef,
} from "./types.js";

export type StartLeadCloudAgentInput = {
  /** Release check goal / target (on-demand only). */
  check: Omit<StartReleaseCheckInput, "trigger"> & {
    trigger?: {
      requestedBy?: string;
      notes?: string;
    };
  };
  /**
   * Durable shared store for ephemeral Lead + specialist Cloud Agents.
   * Prefer FileBackedRunContextStore so agents across VMs share state.
   * When omitted, uses in-memory (unit tests only).
   */
  store?: RunContextStore;
  /** Explicit store URI stamped into run metadata / cloud prompts. */
  storeUri?: string;
  /** Injected CloudAgentClient (tests). Default: resolveCloudAgentClient(). */
  cloudClient?: CloudAgentClient;
  /** Options for specialist Cloud Agent runners. */
  specialists?: CloudSpecialistRunnerOptions;
  /** Extra LeadOrchestrator options (PR client, remediation, …). */
  lead?: Omit<LeadOrchestratorOptions, "store" | "runners">;
};

export type LeadCloudAgentResult = {
  report: ReleaseCheckReport;
  /** Cloud dispatch identity for the ephemeral Lead agent. */
  leadCloud: CloudAgentDispatchResult;
  cloudClientMode: CloudAgentClient["mode"];
  cloudClientDescription: string;
  storeUri?: string;
  /** Always on_demand — Desk UI is the only production trigger. */
  triggerKind: "on_demand";
};

/**
 * Dispatch an ephemeral **Lead Cloud Agent** on-demand, then run orchestration
 * that fans out specialist Cloud Agents (CA / Standards / Security / Builder /
 * AI Red Teaming) via the same `CloudAgentClient` as Coding/Testing/Review.
 *
 * **Trigger model:** Desk UI (or intake after dual human approval) calls this
 * directly. There is **no** background scheduler polling the queue.
 *
 * MOCK default (`RELEASEDESK_CLOUD_CLIENT` unset/`mock`): allocates mock Lead
 * cloud identity, then executes LeadOrchestrator locally with cloud-backed
 * specialist runners (local analysis + nested Coding/Testing/Review MOCK).
 *
 * Real (`RELEASEDESK_CLOUD_CLIENT=real` + `CURSOR_API_KEY`): dispatches Lead to
 * api.cursor.com; local orchestration still coordinates specialist dispatches
 * against the shared durable store until hosted Lead fully owns the loop.
 */
export async function startLeadCloudAgent(
  input: StartLeadCloudAgentInput,
): Promise<LeadCloudAgentResult> {
  const client = input.cloudClient ?? resolveCloudAgentClient(input.specialists?.cloud);
  const store = input.store ?? createInMemoryStore();
  const storeUri =
    input.storeUri ??
    (store instanceof FileBackedRunContextStore ? store.storePath : undefined);

  const repository = String(
    input.check.target.repository ?? "vishamathur/mvp-releasedesk",
  );
  const baseBranch = String(input.check.target.baseRef ?? "main");
  const handoffId = `lead_on_demand_${Date.now().toString(36)}`;

  const sharedContext: SharedRunContextRef | undefined = storeUri
    ? { storeUri }
    : undefined;

  const leadCloud = await client.dispatch({
    handoffId,
    agentKind: "lead",
    prompt: [
      "Ephemeral Lead Cloud Agent — orchestrate Release Desk specialists.",
      `Goal: ${input.check.goal}`,
      `Repository: ${repository}`,
      "Trigger: on_demand from Desk UI (no queue scheduler).",
      "Dispatch Change Analyst, Standards, Security, Builder, AI Red Teaming as Cloud Agents.",
      "Builder may further dispatch Coding → Testing ∥ Review.",
      "Never merge. Human Desk gates remain authoritative.",
      storeUri ? `Shared run-context storeUri: ${storeUri}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    repository,
    baseBranch,
    proposedBranch: `cursor/rd-lead-${handoffId.slice(-8)}`,
    acceptanceCriteria: [
      "Mandatory Security participates",
      "Specialists dispatched as Cloud Agents",
      "Shared durable run context updated",
      "No auto-merge",
      "No background queue polling",
    ],
    autoMerge: false,
    ...(sharedContext ? { sharedContext } : {}),
  });

  if (leadCloud.status === "failed") {
    throw new Error(
      `Lead Cloud Agent dispatch failed: ${leadCloud.error ?? leadCloud.summary}`,
    );
  }

  const runners = createCloudSpecialistRunners({
    ...input.specialists,
    cloudClient: client,
    ...(storeUri ? { storeUri } : {}),
  });

  const lead = new LeadOrchestrator({
    ...input.lead,
    store,
    runners,
  });

  const report = await lead.startOnDemandCheck({
    ...input.check,
    trigger: {
      requestedBy: input.check.trigger?.requestedBy ?? "desk-ui",
      notes:
        input.check.trigger?.notes ??
        "On-demand Lead Cloud Agent from Desk UI (no scheduler)",
    },
    metadata: {
      ...(input.check.metadata ?? {}),
      leadRuntime: "cursor_cloud_agent",
      leadCloudAgentId: leadCloud.cloudAgentId,
      leadCloudRunId: leadCloud.cloudRunId,
      leadCloudAgentUrl: leadCloud.cloudAgentUrl,
      cloudClientMode: client.mode,
      cloudClientDescription: describeCloudClientMode(client),
      triggerSource: "desk_ui_on_demand",
      noScheduler: true,
      ephemeralLead: true,
      ...(storeUri ? { sharedStoreUri: storeUri } : {}),
    },
  });

  return {
    report,
    leadCloud,
    cloudClientMode: client.mode,
    cloudClientDescription: describeCloudClientMode(client),
    ...(storeUri ? { storeUri } : {}),
    triggerKind: "on_demand",
  };
}

/** Helper: open a file-backed shared store for Desk / multi-agent runs. */
export function createSharedRunContextStore(filePath: string): FileBackedRunContextStore {
  return new FileBackedRunContextStore(filePath);
}
