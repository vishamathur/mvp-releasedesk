import type { ProcessStage, SubAgentId, TeammateId } from "./processes.js";
import type { HandoffMessage } from "./schema.js";
import type { BuildResultSlice, RequestRecord, SubAgentEvent } from "./store.js";

export type DraftInput = {
  from: TeammateId;
  to: TeammateId;
  kind: HandoffMessage["kind"];
  action: HandoffMessage["action"];
  stage: string;
  summary: string;
  humanGate: HandoffMessage["humanGate"];
  artifactRefs?: string[];
  proposedBranch?: string;
  prUrl?: string;
  testsPassed?: boolean;
  testsSummary?: string;
};

export type BotContext = {
  inbound: HandoffMessage;
  record: RequestRecord;
  stage: ProcessStage;
  now: string;
  nextTestsPassed: () => boolean;
  draft: (input: DraftInput) => HandoffMessage;
  noteSubAgent: (event: Omit<SubAgentEvent, "seq" | "at" | "parent" | "requestId" | "mock" | "cloudClient"> & {
    at?: string;
  }) => void;
};

/**
 * Mock teammate roster. Every response is labeled MOCK.
 * Cloud sub-agents never call Cursor. RELEASEDESK_CLOUD_CLIENT is ignored.
 */
export const SDLC_ROSTER: Array<{
  id: TeammateId | SubAgentId;
  name: string;
  kind: "teammate" | "subagent";
  parent?: "builder";
  does: string;
}> = [
  {
    id: "lead",
    name: "Release Desk Lead",
    kind: "teammate",
    does: "Opens the request thread, writes pid.state, hands each stage to its owner, and runs the test gate. Never asks for a gate decision and never merges.",
  },
  {
    id: "change-analyst",
    name: "Change Analyst",
    kind: "teammate",
    does: "Owns estimation, and on PID-NC owns discovery, scope, and proposal. Raises the finance and proposal gates and returns the human reply to Lead.",
  },
  {
    id: "standards",
    name: "Standards",
    kind: "teammate",
    does: "Consults on policy for estimation, scope, proposal, security sign-off, build, and release. Returns deviations to the requester. Does not advance pid.state.",
  },
  {
    id: "security",
    name: "Security",
    kind: "teammate",
    does: "Owns security-compliance-approval on every change. Raises that human gate and returns the human reply to Lead. Iteration gate stays red_team|security.",
  },
  {
    id: "builder",
    name: "Builder",
    kind: "teammate",
    does: "Owns build and the release gate. Launches mock Coding, then Testing and Review together, returns a build-result, and raises the release gate. Does not merge.",
  },
  {
    id: "coding",
    name: "Coding",
    kind: "subagent",
    parent: "builder",
    does: "Mock Cursor cloud agent. Ships the change under the Desk rules. Not a handoff recipient.",
  },
  {
    id: "testing",
    name: "Testing",
    kind: "subagent",
    parent: "builder",
    does: "Mock Cursor cloud agent. Verifies the change in parallel with Review. Does not merge.",
  },
  {
    id: "review",
    name: "Review",
    kind: "subagent",
    parent: "builder",
    does: "Mock Cursor cloud agent. Reviews the diff in parallel with Testing. Does not merge.",
  },
];

function consultSummary(bot: TeammateId, stageId: string, pid: RequestRecord["state"]["pid"]): string {
  switch (bot) {
    case "standards":
      return `MOCK: Standards checked the Northwind policy corpus for ${stageId}. No blocking deviation.`;
    case "security":
      return `MOCK: Security found no new release-blocking advisory on ${stageId}. A human signature is still required. Iteration gate stays red_team|security.`;
    case "change-analyst":
      return `MOCK: Change Analyst confirmed the ${stageId} inputs for ${pid}.`;
    case "builder":
      return pid === "PID-NC"
        ? "MOCK: Builder effort consult for the phased estimate. Build starts after kickoff names a future sprint. Cloud client is mock."
        : "MOCK: Builder confirms the sprint build can proceed. Cloud client is mock. Builder does not merge.";
    case "lead":
      return `MOCK: Lead acknowledged the ${stageId} consult.`;
    default:
      return `MOCK: ${bot} replied on ${stageId}.`;
  }
}

export function consultReply(bot: TeammateId, inbound: HandoffMessage, draft: BotContext["draft"]): HandoffMessage {
  return draft({
    from: bot,
    to: inbound.from,
    kind: "consult",
    action: "return",
    stage: inbound.stage,
    summary: consultSummary(bot, inbound.stage, inbound.pid),
    humanGate: null,
  });
}

function withConsults(ctx: BotContext, from: TeammateId): HandoffMessage[] {
  const out: HandoffMessage[] = [];
  for (const to of ctx.stage.consulting) {
    const ask = ctx.draft({
      from,
      to,
      kind: "consult",
      action: "consult",
      stage: ctx.stage.id,
      summary: `MOCK: ${from} asks ${to} to consult on ${ctx.stage.name}.`,
      humanGate: null,
    });
    out.push(ask, consultReply(to, ask, ctx.draft));
  }
  return out;
}

function changeAnalystSummary(ctx: BotContext): string {
  const { id } = ctx.stage;
  if (id === "estimation" && ctx.record.state.pid === "PID-ER") {
    return "MOCK: 3 engineer-days. The change fits the current two-week sprint if finance approves before planning lock.";
  }
  if (id === "estimation") {
    return "MOCK: Phased cost range, 40–60 engineer-days. This is not a sprint t-shirt size.";
  }
  if (id === "discovery") {
    return "MOCK: Discovery notes cover the ask, the sponsor, and the jurisdiction.";
  }
  if (id === "scope") {
    return "MOCK: In scope, out of scope, and assumptions are explicit.";
  }
  return `MOCK: Change Analyst finished ${ctx.stage.name}.`;
}

function securityApproved(record: RequestRecord): boolean {
  return record.decisions.some(
    (decision) => decision.gate === "security-compliance-approval" && decision.decision === "approved",
  );
}

export function mockGateCard(stage: ProcessStage): string {
  return `MOCK human gate card · ${stage.id} · approver: ${stage.humanApprover ?? "human"}. Reply APPROVE or REJECT ${stage.id}.`;
}

function runChangeAnalyst(ctx: BotContext): HandoffMessage[] {
  const consults = withConsults(ctx, "change-analyst");
  if (ctx.stage.humanApprover) return consults;
  return [
    ...consults,
    ctx.draft({
      from: "change-analyst",
      to: "lead",
      kind: "stage-return",
      action: "return",
      stage: ctx.stage.id,
      summary: changeAnalystSummary(ctx),
      humanGate: null,
      artifactRefs: [`memory:pid.estimate.${ctx.record.state.requestId}`],
    }),
  ];
}

function runSecurity(ctx: BotContext): HandoffMessage[] {
  const consults = withConsults(ctx, "security");
  if (ctx.stage.humanApprover) return consults;
  return [
    ...consults,
    ctx.draft({
      from: "security",
      to: "lead",
      kind: "stage-return",
      action: "return",
      stage: ctx.stage.id,
      summary: "MOCK: Security review is complete. Findings are attached. A human signature is still required.",
      humanGate: null,
      artifactRefs: [`memory:pid.security.${ctx.record.state.requestId}`],
    }),
  ];
}

function runBuilder(ctx: BotContext): HandoffMessage[] {
  if (ctx.stage.id === "release-gate") {
    return withConsults(ctx, "builder");
  }
  if (!securityApproved(ctx.record)) {
    return [
      ctx.draft({
        from: "builder",
        to: "lead",
        kind: "stage-return",
        action: "block",
        stage: "build",
        summary: "MOCK: Builder refuses to launch. The human security and compliance gate is not approved.",
        humanGate: null,
      }),
    ];
  }

  const attempt = ctx.record.buildAttempts + 1;
  const testsPassed = ctx.nextTestsPassed();
  const branch = `cursor/handoff-${ctx.record.state.requestId.toLowerCase()}`;
  const prUrl = `https://github.com/vishamathur/mvp-releasedesk/pull/mock-${ctx.record.state.requestId.toLowerCase()}`;
  const coding = "MOCK: Coding cloud agent prepared the Grok release-intel change. No live Cursor call.";
  const testing = testsPassed
    ? "MOCK: Testing cloud agent verified the change. Cloud client is mock."
    : "MOCK: Testing cloud agent failed the change. Lead must return the request to build.";
  const review = "MOCK: Review cloud agent reviewed the diff and did not merge.";

  ctx.noteSubAgent({ agent: "coding", summary: coding, parallelGroup: null });
  ctx.noteSubAgent({ agent: "testing", summary: testing, parallelGroup: "verify" });
  ctx.noteSubAgent({ agent: "review", summary: review, parallelGroup: "verify" });

  const slice: BuildResultSlice = {
    proposedBranch: branch,
    prUrl,
    testsPassed,
    testsSummary: testsPassed
      ? "MOCK: release-intel riskTier low; blockers none. Tests passed. Review did not merge. Cloud client is mock."
      : "MOCK: release-intel riskTier high; blockers: tests failed. Review did not merge. Cloud client is mock.",
    attempt,
  };
  ctx.record.lastBuild = slice;
  ctx.record.buildAttempts = attempt;

  return [
    ...withConsults(ctx, "builder"),
    ctx.draft({
      from: "builder",
      to: "lead",
      kind: "build-result",
      action: "return",
      stage: "build",
      summary: slice.testsSummary,
      humanGate: null,
      artifactRefs: [`memory:pid.build.${ctx.record.state.requestId}`],
      proposedBranch: slice.proposedBranch,
      prUrl: slice.prUrl,
      testsPassed: slice.testsPassed,
      testsSummary: slice.testsSummary,
    }),
  ];
}

export function runStageOwner(owner: TeammateId, ctx: BotContext): HandoffMessage[] {
  switch (owner) {
    case "change-analyst":
      return runChangeAnalyst(ctx);
    case "security":
      return runSecurity(ctx);
    case "builder":
      return runBuilder(ctx);
    case "standards":
      return [
        ctx.draft({
          from: "standards",
          to: "lead",
          kind: "stage-return",
          action: "return",
          stage: ctx.stage.id,
          summary: consultSummary("standards", ctx.stage.id, ctx.record.state.pid),
          humanGate: null,
        }),
      ];
    case "lead":
      return [];
    default:
      return [];
  }
}
