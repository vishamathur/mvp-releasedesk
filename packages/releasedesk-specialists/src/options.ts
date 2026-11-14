import type { GrokClientOptions } from "./grok.js";
import type { ComponentRef } from "./advisories.js";

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
};
