import {
  AI_RED_TEAMING_ROLE,
  assertMandatoryAnalysisRoles,
  MANDATORY_ANALYSIS_ROLES,
  MANDATORY_SECURITY_ROLE,
} from "@releasedesk/core";
import type { AgentRunner, AgentRunnerMap, SpecialistRole } from "@releasedesk/lead";
import { createAiRedTeamingRunner } from "./ai-red-teaming.js";
import { createBuilderRunner } from "./builder.js";
import { createChangeAnalystRunner } from "./change-analyst.js";
import type { SpecialistRunnerOptions } from "./options.js";
import { createSecurityRunner } from "./security.js";
import { createStandardsRunner } from "./standards.js";

/**
 * Default specialist set for every change request.
 * Security is always present — Lead must not omit it for “low risk” changes.
 * AI Red Teaming is the cross-cutting AI/ML guardrail (distinct from Security).
 */
export const DEFAULT_SPECIALIST_ROLES: readonly SpecialistRole[] = [
  "change_analyst",
  "standards",
  "security",
  "builder",
  "ai_red_teaming",
] as const;

assertMandatoryAnalysisRoles([...MANDATORY_ANALYSIS_ROLES]);

/** Build the specialist runners for injection into `LeadOrchestrator`. */
export function createSpecialistRunners(
  options: SpecialistRunnerOptions = {},
): Record<SpecialistRole, AgentRunner> {
  const runners: Record<SpecialistRole, AgentRunner> = {
    change_analyst: createChangeAnalystRunner(options),
    standards: createStandardsRunner(options),
    security: createSecurityRunner(options),
    builder: createBuilderRunner(options),
    ai_red_teaming: createAiRedTeamingRunner(options),
  };
  if (!(MANDATORY_SECURITY_ROLE in runners) || !runners.security) {
    throw new Error(
      "Security runner missing from default specialist set — mandatory on every change",
    );
  }
  if (!(AI_RED_TEAMING_ROLE in runners) || !runners.ai_red_teaming) {
    throw new Error("AI Red Teaming runner missing from default specialist set");
  }
  return runners;
}

/** Partial map helper when swapping one role at a time. */
export function createSpecialistRunnerMap(
  options: SpecialistRunnerOptions = {},
): AgentRunnerMap {
  return createSpecialistRunners(options);
}
