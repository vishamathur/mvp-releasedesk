import type { GrokClientOptions } from "./grok.js";
import type { ComponentRef } from "./advisories.js";
import type { CloudAgentClient } from "./cloud/types.js";
import type { ResolveCloudAgentClientOptions } from "./cloud/resolve.js";

/** Shared options for specialist runners (injectable for tests). */
export type SpecialistRunnerOptions = {
  /** Monorepo / git working directory (default: detected workspace root). */
  workspaceRoot?: string;
  /** Override policies directory. */
  policiesDir?: string;
  /** Override sample advisories JSON path. */
  advisoriesPath?: string;
  /** Force Grok client options. A missing exclusive key throws. */
  grok?: GrokClientOptions;
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
};
