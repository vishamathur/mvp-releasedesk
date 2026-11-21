import type { ParentBotId } from "./schema.js";

/** Default per-child budget. Tests inject a shorter budget to force timeouts. */
export const DEFAULT_SUB_AGENT_TIMEOUT_MS = 20_000;

export type SubAgentCatalogEntry = {
  id: string;
  parentId: ParentBotId;
  responsibility: string;
  required: boolean;
  /** Same group runs with Promise.all. Later groups see earlier results. */
  parallelGroup: number;
  timeoutMs: number;
};

function entry(
  parentId: ParentBotId,
  id: string,
  responsibility: string,
  parallelGroup: number,
  required = true,
): SubAgentCatalogEntry {
  return {
    id,
    parentId,
    responsibility,
    required,
    parallelGroup,
    timeoutMs: DEFAULT_SUB_AGENT_TIMEOUT_MS,
  };
}

/**
 * Child slices for the five existing bots.
 * Not registry rows, not catalog.bots entries, not AgentRole values.
 */
export const SUB_AGENT_CATALOG: Record<ParentBotId, readonly SubAgentCatalogEntry[]> = {
  lead: [
    entry(
      "lead",
      "lead.intake-routing",
      "Route the run onto the ER sprint track or the new-customer kickoff track.",
      0,
    ),
    entry(
      "lead",
      "lead.kickoff",
      "Discover scope and write a proposal that still needs human approval.",
      1,
    ),
    entry(
      "lead",
      "lead.release-aggregation",
      "Aggregate specialist results into readiness without approving gates.",
      2,
    ),
  ],
  change_analyst: [
    entry(
      "change_analyst",
      "change_analyst.er-intake",
      "Normalize the ER or change request into repository, refs, and focus paths.",
      0,
    ),
    entry(
      "change_analyst",
      "change_analyst.diff-impact",
      "Read the git range and score path-level impact.",
      0,
    ),
    entry(
      "change_analyst",
      "change_analyst.estimation",
      "Estimate effort from the diff and impact findings.",
      1,
    ),
  ],
  standards: [
    entry(
      "standards",
      "standards.policy-rules",
      "Evaluate the change against Northwind policy rules.",
      0,
    ),
    entry(
      "standards",
      "standards.docs-conventions",
      "Check docs and repo conventions that sit beside the policy rules.",
      0,
    ),
  ],
  security: [
    entry(
      "security",
      "security.secret-scan",
      "Scan change input for private keys and hardcoded credentials.",
      0,
    ),
    entry(
      "security",
      "security.dependency-cve",
      "Correlate dependencies to advisory and CVE fixtures.",
      0,
    ),
    entry(
      "security",
      "security.red-team-prompts",
      "Review AI surfaces and prompt text for red-team bypasses.",
      0,
    ),
  ],
  builder: [
    entry(
      "builder",
      "builder.backend-api",
      "Plan the backend and API slice of the remediation.",
      0,
    ),
    entry(
      "builder",
      "builder.frontend-ui",
      "Plan the frontend and UI slice of the remediation.",
      0,
    ),
    entry(
      "builder",
      "builder.tests-ci",
      "Plan the tests and CI slice of the remediation.",
      0,
    ),
  ],
};

const PARENT_ORDER: readonly ParentBotId[] = [
  "lead",
  "change_analyst",
  "standards",
  "security",
  "builder",
];

export function listSubAgentCatalog(): SubAgentCatalogEntry[] {
  return PARENT_ORDER.flatMap((parentId) => [...SUB_AGENT_CATALOG[parentId]]);
}

export function catalogEntry(parentId: ParentBotId, id: string): SubAgentCatalogEntry {
  const found = SUB_AGENT_CATALOG[parentId].find((child) => child.id === id);
  if (!found) {
    throw new Error(`Unknown sub-agent ${id} for parent ${parentId}`);
  }
  return found;
}
