import { z } from "zod";

export const AgentRoleSchema = z.enum([
  "lead",
  "change_analyst",
  "standards",
  "security",
  "builder",
  "ai_red_teaming",
]);

export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  lead: "Lead Agent",
  change_analyst: "Change Analyst",
  standards: "Standards Agent",
  security: "Security Agent",
  builder: "Builder Agent",
  ai_red_teaming: "AI Red Teaming",
};
