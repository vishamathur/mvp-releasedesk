import type { AgentRunner, AgentRunnerMap, SpecialistRole } from "@releasedesk/lead";
import { createBuilderRunner } from "./builder.js";
import { createChangeAnalystRunner } from "./change-analyst.js";
import type { SpecialistRunnerOptions } from "./options.js";
import { createSecurityRunner } from "./security.js";
import { createStandardsRunner } from "./standards.js";

/** Build the four real specialist runners for injection into `LeadOrchestrator`. */
export function createSpecialistRunners(
  options: SpecialistRunnerOptions = {},
): Record<SpecialistRole, AgentRunner> {
  return {
    change_analyst: createChangeAnalystRunner(options),
    standards: createStandardsRunner(options),
    security: createSecurityRunner(options),
    builder: createBuilderRunner(options),
  };
}

/** Partial map helper when swapping one role at a time. */
export function createSpecialistRunnerMap(
  options: SpecialistRunnerOptions = {},
): AgentRunnerMap {
  return createSpecialistRunners(options);
}
