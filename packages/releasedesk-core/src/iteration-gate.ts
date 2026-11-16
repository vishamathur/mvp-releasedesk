import { z } from "zod";

/**
 * PR #14 iteration hard gate: every code iteration requires
 * red_team OR security human approval before proceed/ship.
 * Human merge/release gates remain separate and mandatory.
 */

export const IterationApprovalKindSchema = z.enum(["red_team", "security"]);
export type IterationApprovalKind = z.infer<typeof IterationApprovalKindSchema>;

export const IterationApprovalSchema = z.object({
  iterationId: z.string().min(1),
  kind: IterationApprovalKindSchema,
  approvedBy: z.string().min(1),
  approvedAt: z.string().datetime(),
  note: z.string().optional(),
});
export type IterationApproval = z.infer<typeof IterationApprovalSchema>;

export const IterationProceedGateSchema = z.object({
  iterationId: z.string().min(1),
  /** Hard gate: always true — iteration cannot ship without red_team or security. */
  mandatoryApproval: z.literal(true),
  hasRedTeamApproval: z.boolean(),
  hasSecurityApproval: z.boolean(),
  /** True when at least one of red_team | security is present. */
  satisfied: z.boolean(),
  canProceed: z.boolean(),
  blockingIssue: z.string().optional(),
  approvals: z.array(IterationApprovalSchema).default([]),
});
export type IterationProceedGate = z.infer<typeof IterationProceedGateSchema>;

export type EvaluateIterationProceedInput = {
  iterationId: string;
  approvals: readonly IterationApproval[];
};

/**
 * Hard gate: every code iteration requires red_team **or** security approval.
 * Neither → cannot proceed / cannot ship.
 */
export function evaluateIterationProceedGate(
  input: EvaluateIterationProceedInput,
): IterationProceedGate {
  const forIteration = input.approvals.filter((a) => a.iterationId === input.iterationId);
  const hasRedTeamApproval = forIteration.some((a) => a.kind === "red_team");
  const hasSecurityApproval = forIteration.some((a) => a.kind === "security");
  const satisfied = hasRedTeamApproval || hasSecurityApproval;

  return IterationProceedGateSchema.parse({
    iterationId: input.iterationId,
    mandatoryApproval: true,
    hasRedTeamApproval,
    hasSecurityApproval,
    satisfied,
    canProceed: satisfied,
    ...(satisfied
      ? {}
      : {
          blockingIssue:
            "Iteration hard gate: require red_team approval or security approval before proceeding (neither recorded)",
        }),
    approvals: forIteration,
  });
}
