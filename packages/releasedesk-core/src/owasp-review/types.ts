import type { GrokTelemetry } from "../grok-telemetry.js";
import type { OwaspControlGroup, OwaspControlId } from "./catalogue.js";

export const OWASP_REVIEW_SCHEMA = "owasp-review.v1" as const;

export const OWASP_VERDICTS = ["PASS", "FAIL", "NOT_APPLICABLE", "UNDECIDED"] as const;
export type OwaspVerdict = (typeof OWASP_VERDICTS)[number];

export const OWASP_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type OwaspSeverity = (typeof OWASP_SEVERITIES)[number];

export const OWASP_OUTCOMES = ["auto-proceed", "remediate", "needs-human", "skipped"] as const;
export type OwaspOutcome = (typeof OWASP_OUTCOMES)[number];

export const OWASP_REVIEW_STATUSES = ["completed", "failed", "skipped"] as const;
export type OwaspReviewStatus = (typeof OWASP_REVIEW_STATUSES)[number];

export const OWASP_EXCEPTION_TYPES = [
  "AMBIGUOUS",
  "FIX_DISPUTED",
  "NOT_AUTO_FIXABLE",
  "MANUAL_REQUESTED",
  "REVIEW_FAILED",
] as const;
export type OwaspExceptionType = (typeof OWASP_EXCEPTION_TYPES)[number];

/** A confirmed FAIL is handed to Builder at this path and line. */
export type OwaspSuggestedFix = {
  what: string;
  where: string;
  why: string;
  owaspId: string;
};

export type OwaspFailure = {
  id: OwaspControlId;
  path: string;
  line: number;
  severity: OwaspSeverity;
  evidence: string;
  suggestedFix: OwaspSuggestedFix;
  autoFixable: boolean;
};

export type OwaspDropped = {
  id: string;
  path: string;
  line: number | null;
  evidence: string;
  severity: string;
  reason: string;
};

export type OwaspException = {
  type: OwaspExceptionType;
  controlId: string | null;
  path: string | null;
  line: number | null;
  reason: string;
};

export type OwaspControlResult = {
  id: OwaspControlId;
  name: string;
  group: OwaspControlGroup;
  verdict: OwaspVerdict;
  selected: boolean;
  /** Rule ids that selected this control. Empty when it was not selected. */
  rules: string[];
  /** Changed paths that matched those rules. */
  paths: string[];
  reason: string;
  path: string | null;
  line: number | null;
  evidence: string;
  severity: OwaspSeverity | null;
  confidence: number | null;
  autoFixable: boolean | null;
  suggestedFix: OwaspSuggestedFix | null;
};

export type OwaspReviewReport = {
  schema: typeof OWASP_REVIEW_SCHEMA;
  heading: "owasp-review v1";
  status: OwaspReviewStatus;
  outcome: OwaspOutcome;
  /** assessed only when status is completed. A failed or skipped review is not a pass. */
  risk: "assessed" | "not_assessed";
  advisory: true;
  humanGateStillRequired: true;
  noAutoApprove: true;
  /** Env var that supplied the key. Null when the review was skipped. Never a key value. */
  keyEnvVar: string | null;
  headSha: string | null;
  /** Previous report head, when one was read. Same head does not increment remediation rounds. */
  priorHeadSha: string | null;
  generatedAt: string;
  repository: string;
  pullRequest: number | null;
  title: string;
  docsOnly: boolean;
  filesTotal: number;
  filesSent: number;
  diffTruncated: boolean;
  /** Controls the selector chose. Empty when the review did not assess. */
  selectedControlIds: OwaspControlId[];
  controls: OwaspControlResult[];
  failures: OwaspFailure[];
  droppedUngrounded: OwaspDropped[];
  exceptions: OwaspException[];
  /** Consecutive completed-review FAILs per control, including this head. */
  failureRounds: Record<string, number>;
  model: string | null;
  requestedModel: string | null;
  telemetry: GrokTelemetry | null;
  /** Present when status is failed or skipped. No secret values. */
  error?: string;
};

export type DiffFile = {
  path: string;
  patch: string;
  status?: string;
};

export type BuilderDispute = {
  id: string;
  disputed: boolean;
  reason: string;
  path?: string | null;
  line?: number | null;
};

export type OwaspReviewInput = {
  repository: string;
  pullRequest: number | null;
  headSha: string | null;
  priorHeadSha?: string | null;
  title?: string;
  files: readonly DiffFile[];
  manualReview?: boolean;
  /** Why manual review was requested, recorded on the MANUAL_REQUESTED exception. */
  manualReviewReason?: string;
  builderDisputes?: readonly BuilderDispute[];
  /** Consecutive FAIL rounds from earlier heads. */
  priorFailureRounds?: Readonly<Record<string, number>>;
  generatedAt?: string;
  /** Override the numbered-diff token budget. The runner sets this from the environment. */
  diffTokenBudget?: number;
};
