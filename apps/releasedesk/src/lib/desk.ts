import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  FileBackedRunContextStore,
  createInMemoryStore,
  nowIso,
  type IterationApprovalKind,
  type RunContextStore,
} from "@releasedesk/core";
import {
  LeadOrchestrator,
  createDefaultStubRunners,
  createMockPrClient,
  createDmSession,
  getIncompleteChecklists,
  getPendingGates,
  receiveDmText,
  replyAsLead,
  type AgentRunnerMap,
  type ApprovalDecision,
  type DmSession,
  type FeatureSignOffItemId,
  type FeatureSignOffRecord,
  type ReleaseCheckReport,
} from "@releasedesk/lead";
import {
  applyIterationSignOff,
  createPendingIterationGateDemo,
  recomputeIterationGate,
} from "./iteration-gate";
import { DEMO_SCENARIOS, isDemoScenarioId, runnersForScenario } from "./scenarios";
import type { DemoScenarioId, DeskReport, RunListItem } from "./types";

const DEFAULT_REPO = "vishamathur/mvp-releasedesk";

function resolveAppRoot(): string {
  if (process.cwd().endsWith(`${path.sep}releasedesk`) || process.cwd().endsWith("/releasedesk")) {
    return process.cwd();
  }
  return path.join(process.cwd(), "apps", "releasedesk");
}

function paths() {
  const root = resolveAppRoot();
  return {
    root,
    data: path.join(root, "data"),
    reports: path.join(root, "data", "reports"),
    fixtures: path.join(root, "fixtures", "demos"),
    storeFile: path.join(root, "data", "runs.json"),
  };
}

async function ensureDirs() {
  const p = paths();
  await mkdir(p.reports, { recursive: true });
  await mkdir(p.data, { recursive: true });
  return p;
}

function normalizeReport(report: ReleaseCheckReport): ReleaseCheckReport {
  return {
    ...report,
    featureSignOffs: report.featureSignOffs ?? { checklists: [] },
    aiFrameworkWaivers: report.aiFrameworkWaivers ?? { waivers: [] },
  };
}

export function viewReport(desk: DeskReport): ReleaseCheckReport {
  const lead = new LeadOrchestrator({
    store: createInMemoryStore(),
    enableRemediation: false,
  });

  let view = normalizeReport(desk.report);

  if (desk.featureSignOffOverlay) {
    const baseChecklists = (desk.report.featureSignOffs?.checklists ?? []).map((c) => ({
      ...c,
      status: "pending" as const,
      completedAt: undefined,
      completedBy: undefined,
      items: c.items.map((i) => ({
        ...i,
        signedOff: false,
        signedOffAt: undefined,
        signedOffBy: undefined,
        notes: undefined,
      })),
      feature: { ...c.feature },
    }));
    const base: ReleaseCheckReport = {
      ...view,
      featureSignOffs: { checklists: baseChecklists },
    };
    type SignOffDecision = {
      checklistId: string;
      itemId?: FeatureSignOffItemId;
      signOffAll?: boolean;
      signedOffBy?: string;
      notes?: string;
    };
    const decisions: SignOffDecision[] = [];
    for (const c of desk.featureSignOffOverlay.checklists) {
      const signedItems = c.items.filter((i) => i.signedOff);
      if (c.status === "completed" || signedItems.length === c.items.length) {
        decisions.push({
          checklistId: c.id,
          signOffAll: true,
          ...(c.completedBy !== undefined ? { signedOffBy: c.completedBy } : {}),
        });
        continue;
      }
      for (const i of signedItems) {
        decisions.push({
          checklistId: c.id,
          itemId: i.id as FeatureSignOffItemId,
          ...(i.signedOffBy !== undefined ? { signedOffBy: i.signedOffBy } : {}),
          ...(i.notes !== undefined ? { notes: i.notes } : {}),
        });
      }
    }
    if (decisions.length > 0) {
      view = lead.applyFeatureSignOffsToReport(base, decisions);
    }
  }

  if (!desk.approvalOverlay) return view;

  const baseGates = view.approvals.gates.map((g) => ({
    ...g,
    status: "pending" as const,
    decidedAt: undefined,
    decidedBy: undefined,
    notes: undefined,
  }));
  const base: ReleaseCheckReport = {
    ...view,
    approvals: { gates: baseGates },
  };

  const decisions = desk.approvalOverlay.gates
    .filter((g) => g.status !== "pending")
    .map((g) => ({
      gateId: g.id,
      decision: g.status as Exclude<ApprovalDecision, "pending">,
      ...(g.decidedBy !== undefined ? { decidedBy: g.decidedBy } : {}),
      ...(g.notes !== undefined ? { notes: g.notes } : {}),
    }));

  if (decisions.length === 0) return view;
  return lead.applyApprovalsToReport(base, decisions);
}

function toListItem(desk: DeskReport): RunListItem {
  const report = viewReport(desk);
  return {
    runId: desk.runId,
    goal: report.run.goal,
    repository: String(report.run.target.repository ?? DEFAULT_REPO),
    readiness: report.leadOutput.readiness,
    status: report.run.status,
    ...(desk.scenarioId !== undefined ? { scenarioId: desk.scenarioId } : {}),
    ...(desk.scenarioLabel !== undefined ? { scenarioLabel: desk.scenarioLabel } : {}),
    createdAt: desk.createdAt,
    updatedAt: desk.updatedAt,
    blockingCount: report.leadOutput.blockingIssues.length,
    pendingApprovals:
      getPendingGates(report.approvals).length +
      getIncompleteChecklists(report.featureSignOffs).length +
      (desk.iterationGate &&
      recomputeIterationGate(desk.iterationGate).uiStatus === "pending"
        ? 1
        : 0),
    checkpointCount: report.checkpoints.checkpoints.length,
    prCount: report.pullRequests.pullRequests.length,
    mockIntegrations: desk.prClientMode === "mock",
  };
}

export async function writeDeskReport(desk: DeskReport): Promise<void> {
  const p = await ensureDirs();
  await writeFile(
    path.join(p.reports, `${desk.runId}.json`),
    `${JSON.stringify(desk, null, 2)}\n`,
    "utf8",
  );
}

export { wrapReport as wrapDeskReport };

async function readDeskReport(runId: string): Promise<DeskReport | undefined> {
  const p = await ensureDirs();
  try {
    const raw = await readFile(path.join(p.reports, `${runId}.json`), "utf8");
    return JSON.parse(raw) as DeskReport;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

function wrapReport(
  report: ReleaseCheckReport,
  extras?: { scenarioId?: DemoScenarioId; scenarioLabel?: string },
): DeskReport {
  return {
    runId: report.runId,
    createdAt: report.run.createdAt,
    updatedAt: nowIso(),
    prClientMode: "mock",
    autoMerge: false,
    report,
    dmSession: report.dmSession,
    ...(extras?.scenarioId !== undefined ? { scenarioId: extras.scenarioId } : {}),
    ...(extras?.scenarioLabel !== undefined ? { scenarioLabel: extras.scenarioLabel } : {}),
  };
}

function createLead(opts: {
  store: RunContextStore;
  runners?: AgentRunnerMap;
  enableRemediation?: boolean;
  maxRemediationCycles?: number;
}): LeadOrchestrator {
  return new LeadOrchestrator({
    store: opts.store,
    runners: opts.runners ?? createDefaultStubRunners(),
    enableRemediation: opts.enableRemediation ?? true,
    maxRemediationCycles: opts.maxRemediationCycles ?? 2,
    prClient: { client: createMockPrClient() },
  });
}

export async function listRuns(): Promise<RunListItem[]> {
  const p = await ensureDirs();
  let files: string[] = [];
  try {
    files = (await readdir(/*turbopackIgnore: true*/ p.reports)).filter((f) =>
      f.endsWith(".json"),
    );
  } catch {
    files = [];
  }
  const items: RunListItem[] = [];
  for (const file of files) {
    const desk = await readDeskReport(file.replace(/\.json$/, ""));
    if (desk) items.push(toListItem(desk));
  }
  items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return items;
}

export async function getRun(runId: string) {
  const desk = await readDeskReport(runId);
  if (!desk) return undefined;
  const view = viewReport(desk);
  const iterationGate = desk.iterationGate
    ? recomputeIterationGate(desk.iterationGate)
    : undefined;
  return {
    desk,
    view,
    list: toListItem({ ...desk, report: view }),
    ...(iterationGate !== undefined ? { iterationGate } : {}),
  };
}

export async function startOnDemandCheck(input?: {
  goal?: string;
  repository?: string;
  requestedBy?: string;
}) {
  const p = await ensureDirs();
  const store = new FileBackedRunContextStore(p.storeFile);
  const lead = createLead({ store, enableRemediation: false, maxRemediationCycles: 0 });
  const report = await lead.startOnDemandCheck({
    goal: input?.goal ?? "On-demand release readiness check (Release Desk UI)",
    target: {
      repository: input?.repository ?? DEFAULT_REPO,
      baseRef: "main",
      headRef: "HEAD",
    },
    trigger: {
      requestedBy: input?.requestedBy ?? "delivery-manager",
      notes: "Started from Release Desk UI",
    },
  });
  const desk = wrapReport(report);
  await writeDeskReport(desk);
  return { desk, view: report, list: toListItem(desk) };
}

export async function runDemoScenario(scenarioId: DemoScenarioId) {
  const meta = DEMO_SCENARIOS.find((s) => s.id === scenarioId)!;
  const cfg = runnersForScenario(scenarioId);
  const store = createInMemoryStore();
  const lead = createLead({
    store,
    runners: cfg.runners,
    enableRemediation: cfg.enableRemediation,
    maxRemediationCycles: cfg.maxRemediationCycles,
  });
  const report = await lead.startOnDemandCheck({
    goal: cfg.goal,
    target: { repository: DEFAULT_REPO, baseRef: "main", headRef: "HEAD" },
    trigger: {
      requestedBy: "demo-scenario",
      notes: `Demo scenario: ${meta.title}`,
    },
    metadata: { scenarioId, scenarioLabel: meta.title },
  });
  const desk = wrapReport(report, { scenarioId, scenarioLabel: meta.title });
  await writeDeskReport(desk);
  return { desk, view: report, list: toListItem(desk) };
}

export async function loadFixtureScenario(scenarioId: DemoScenarioId) {
  const p = await ensureDirs();
  try {
    const raw = await readFile(path.join(p.fixtures, `${scenarioId}.json`), "utf8");
    const fixture = JSON.parse(raw) as DeskReport;
    const cloned: DeskReport = { ...fixture, updatedAt: nowIso() };
    await writeDeskReport(cloned);
    const view = viewReport(cloned);
    return { desk: cloned, view, list: toListItem({ ...cloned, report: view }) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export async function startIterationApprovalDemo() {
  const base = await runDemoScenario("pending-approval");
  const iterationGate = createPendingIterationGateDemo();
  const desk: DeskReport = {
    ...base.desk,
    scenarioId: "iteration-approval-gate",
    scenarioLabel: "Iteration approval gate",
    iterationGate,
    updatedAt: nowIso(),
    report: {
      ...base.desk.report,
      leadOutput: {
        ...base.desk.report.leadOutput,
        readiness: "needs_human",
        summary: formatIterationGateSummary(iterationGate.iterationId, "pending"),
        blockingIssues: [
          ...base.desk.report.leadOutput.blockingIssues.filter(
            (b) => !b.startsWith("Iteration hard gate:"),
          ),
          `Iteration hard gate: ${iterationGate.iterationId} awaiting red_team or security approval`,
        ],
      },
    },
  };
  await writeDeskReport(desk);
  const view = viewReport(desk);
  return {
    desk,
    view,
    list: toListItem({ ...desk, report: view }),
    iterationGate: recomputeIterationGate(iterationGate),
  };
}

function formatIterationGateSummary(
  iterationId: string,
  uiStatus: "pending" | "open" | "blocked",
): string {
  if (uiStatus === "open") {
    return `Iteration ${iterationId} gate OPEN — red_team|security approval satisfied; main flow may proceed (remediation side-queue non-blocking).`;
  }
  if (uiStatus === "blocked") {
    return `Iteration ${iterationId} gate BLOCKED — sign-off rejected; cannot proceed without red_team or security approval.`;
  }
  return `Iteration ${iterationId} gate PENDING — hard block until red_team OR security approval.`;
}

export async function applyIterationGateDecision(input: {
  runId: string;
  decision: "approved" | "rejected";
  kind?: IterationApprovalKind;
  decidedBy?: string;
  note?: string;
}) {
  const desk = await readDeskReport(input.runId);
  if (!desk) throw new Error(`Run ${input.runId} not found`);
  if (!desk.iterationGate) {
    throw new Error(`Run ${input.runId} has no iteration gate demo state`);
  }

  const nextState = applyIterationSignOff(desk.iterationGate, {
    decision: input.decision,
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    decidedBy: input.decidedBy ?? "delivery-manager@northwind",
    ...(input.note !== undefined ? { note: input.note } : {}),
  });
  const computed = recomputeIterationGate(nextState);

  const otherBlockers = desk.report.leadOutput.blockingIssues.filter(
    (b) => !b.startsWith("Iteration hard gate:"),
  );
  const blockingIssues =
    computed.uiStatus === "open"
      ? otherBlockers
      : [
          ...otherBlockers,
          computed.uiStatus === "blocked"
            ? `Iteration hard gate: ${nextState.iterationId} blocked (sign-off rejected)`
            : `Iteration hard gate: ${nextState.iterationId} awaiting red_team or security approval`,
        ];

  const updated: DeskReport = {
    ...desk,
    iterationGate: nextState,
    updatedAt: nowIso(),
    report: {
      ...desk.report,
      leadOutput: {
        ...desk.report.leadOutput,
        readiness: computed.uiStatus === "open" ? desk.report.leadOutput.readiness : "needs_human",
        summary: formatIterationGateSummary(nextState.iterationId, computed.uiStatus),
        blockingIssues,
      },
    },
  };
  await writeDeskReport(updated);
  const view = viewReport(updated);
  return {
    desk: updated,
    view,
    list: toListItem({ ...updated, report: view }),
    iterationGate: computed,
  };
}

export async function startDemoScenario(
  scenarioId: string,
  mode: "live" | "fixture" = "live",
) {
  if (!isDemoScenarioId(scenarioId)) {
    throw new Error(`Unknown demo scenario: ${scenarioId}`);
  }
  if (scenarioId === "iteration-approval-gate") {
    return startIterationApprovalDemo();
  }
  if (mode === "fixture") {
    const loaded = await loadFixtureScenario(scenarioId);
    if (loaded) return loaded;
  }
  return runDemoScenario(scenarioId);
}

export async function applyGateDecision(input: {
  runId: string;
  gateId: string;
  decision: Exclude<ApprovalDecision, "pending">;
  decidedBy?: string;
  notes?: string;
}) {
  const desk = await readDeskReport(input.runId);
  if (!desk) throw new Error(`Run ${input.runId} not found`);

  const current = viewReport(desk);
  const gate = current.approvals.gates.find((g) => g.id === input.gateId);
  if (!gate) throw new Error(`Gate ${input.gateId} not found`);
  if (gate.status !== "pending") {
    throw new Error(`Gate ${input.gateId} is already ${gate.status}`);
  }

  const lead = new LeadOrchestrator({
    store: createInMemoryStore(),
    enableRemediation: false,
  });
  const nextView = lead.applyApprovalsToReport(current, [
    {
      gateId: input.gateId,
      decision: input.decision,
      decidedBy: input.decidedBy ?? "delivery-manager",
      notes:
        input.notes ??
        (input.decision === "approved"
          ? "Approved in Release Desk UI (no auto-merge)"
          : "Rejected in Release Desk UI"),
    },
  ]);

  const updated: DeskReport = {
    ...desk,
    updatedAt: nowIso(),
    approvalOverlay: nextView.approvals,
    featureSignOffOverlay: nextView.featureSignOffs,
    dmSession: nextView.dmSession,
    report: {
      ...desk.report,
      leadOutput: nextView.leadOutput,
      assessment: nextView.assessment,
      featureSignOffs: desk.report.featureSignOffs ?? { checklists: [] },
    },
  };

  await writeDeskReport(updated);
  const view = viewReport(updated);
  return { desk: updated, view, list: toListItem({ ...updated, report: view }) };
}

export async function applyFeatureSignOffDecision(input: {
  runId: string;
  checklistId: string;
  itemId?: FeatureSignOffItemId;
  signOffAll?: boolean;
  signedOffBy?: string;
  notes?: string;
}) {
  const desk = await readDeskReport(input.runId);
  if (!desk) throw new Error(`Run ${input.runId} not found`);

  const current = viewReport(desk);
  const checklist = current.featureSignOffs.checklists.find((c) => c.id === input.checklistId);
  if (!checklist) throw new Error(`Feature checklist ${input.checklistId} not found`);
  if (checklist.status === "completed") {
    throw new Error(`Feature checklist ${input.checklistId} is already completed`);
  }
  if (!input.signOffAll && !input.itemId) {
    throw new Error("itemId or signOffAll is required");
  }
  if (input.itemId) {
    const item = checklist.items.find((i) => i.id === input.itemId);
    if (!item) throw new Error(`Checklist item ${input.itemId} not found`);
    if (item.signedOff) throw new Error(`Checklist item ${input.itemId} is already signed off`);
  }

  const lead = new LeadOrchestrator({
    store: createInMemoryStore(),
    enableRemediation: false,
  });
  const nextView = lead.applyFeatureSignOffsToReport(current, [
    {
      checklistId: input.checklistId,
      ...(input.itemId !== undefined ? { itemId: input.itemId } : {}),
      ...(input.signOffAll ? { signOffAll: true } : {}),
      signedOffBy: input.signedOffBy ?? "developer",
      notes: input.notes ?? "Signed off in Release Desk UI",
    },
  ]);

  const updated: DeskReport = {
    ...desk,
    updatedAt: nowIso(),
    featureSignOffOverlay: nextView.featureSignOffs,
    approvalOverlay: desk.approvalOverlay ?? nextView.approvals,
    dmSession: nextView.dmSession,
    report: {
      ...desk.report,
      leadOutput: nextView.leadOutput,
      assessment: nextView.assessment,
      featureSignOffs: desk.report.featureSignOffs ?? { checklists: [] },
    },
  };

  await writeDeskReport(updated);
  const view = viewReport(updated);
  return { desk: updated, view, list: toListItem({ ...updated, report: view }) };
}

/** @internal helper for tests / fixtures missing featureSignOffs */
export function emptyFeatureSignOffs(): FeatureSignOffRecord {
  return { checklists: [] };
}

export async function postDmMessage(input: {
  runId?: string;
  text: string;
  channel: "text" | "voice";
}): Promise<{ dmSession: DmSession; runId?: string }> {
  let session: DmSession;

  if (input.channel === "voice") {
    const lead = new LeadOrchestrator({
      store: createInMemoryStore(),
      enableRemediation: false,
    });
    lead.handleDmVoice(input.text);
    session = lead.getDmSession();
  } else {
    session = replyAsLead(
      receiveDmText(createDmSession(), input.text),
      "Message received. Use Start release check or a demo scenario to drive real orchestrator output.",
    );
  }

  if (input.runId) {
    const desk = await readDeskReport(input.runId);
    if (desk) {
      const merged: DeskReport = {
        ...desk,
        dmSession: {
          messages: [...desk.dmSession.messages, ...session.messages],
        },
        updatedAt: nowIso(),
      };
      await writeDeskReport(merged);
      return { dmSession: merged.dmSession, runId: input.runId };
    }
  }

  return { dmSession: session, ...(input.runId ? { runId: input.runId } : {}) };
}

export function listDemoScenarios() {
  return DEMO_SCENARIOS;
}

export { isDemoScenarioId, paths as deskPaths };
