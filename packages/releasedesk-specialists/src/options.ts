import type { SubAgentChildRun, SubAgentChildResult } from "@releasedesk/core";
import type { GrokClientOptions } from "./grok.js";
import type { ComponentRef } from "./advisories.js";
import type { CloudAgentClient } from "./cloud/types.js";
import type { ResolveCloudAgentClientOptions } from "./cloud/resolve.js";

/** Test seam for child delegation. Production leaves both unset. */
export type SubAgentRunnerHooks = {
  timeoutMs?: number;
  timeoutMsById?: Record<string, number>;
  runOverrides?: Record<
    string,
    (
      context: unknown,
      prior: readonly SubAgentChildResult[],
    ) => ReturnType<SubAgentChildRun<unknown>>
  >;
};

/** Shared options for specialist runners (injectable for tests). */
export type SpecialistRunnerOptions = {
  /** Monorepo / git working directory (default: detected workspace root). */
  workspaceRoot?: string;
  /** Override policies directory. */
  policiesDir?: string;
  /** Override sample advisories JSON path. */
  advisoriesPath?: string;
  /** Override release-notes fixture path. */
  releaseNotesPath?: string;
  /** Force Grok client options (including missing key → MOCK). */
  grok?: GrokClientOptions;
  /** Skip optional Grok narrative enrichment entirely. */
  skipGrok?: boolean;
  /** Extra components for security correlation (merged with discovered). */
  extraComponents?: ComponentRef[];
  /**
   * When true, treat human approval gates as present for standards signals
   * (Lead always requests them — default true for Release Desk runs).
   */
  assumeLeadHumanGates?: boolean;
  /**
   * Injected Cursor Cloud Agent client (wins over env resolution).
   * Prefer for unit tests; production uses resolveCloudAgentClient().
   */
  cloudClient?: CloudAgentClient;
  /** Extra resolve options when cloudClient is not injected. */
  cloud?: ResolveCloudAgentClientOptions;
  /** Per-handoff Cloud Agent dispatch attempts (default 2). */
  cloudMaxAttempts?: number;
  /**
   * When true, Builder only plans handoffs (M4 behavior) and does not dispatch.
   * Default false — M5 dispatches via MOCK or real client.
   */
  skipCloudDispatch?: boolean;
  /**
   * Replace or shorten child sub-agent runs. Used by delegation tests.
   * Does not add roster bots and does not change the public result fields.
   */
  subAgents?: SubAgentRunnerHooks;
};
