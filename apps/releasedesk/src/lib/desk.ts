import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  FileBackedRunContextStore,
  createInMemoryStore,
  nowIso,
  type RunContextStore,
} from "@releasedesk/core";
import {
  LeadOrchestrator,
  createDefaultStubRunners,
  createMockPrClient,
  createDmSession,
  getPendingGates,
  receiveDmText,
  replyAsLead,
  type AgentRunnerMap,
  type ApprovalDecision,
  type DmSession,
  type ReleaseCheckReport,
} from "@releasedesk/lead";
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

function emptyAgileArtifacts() {
  return {
    testGates: { gates: [] as never[] },
    releaseNotes: { packages: [] as never[] },
    rollback: { plans: [] as never[] },
    observability: {
      summary: {
        mode: "mock" as const,
        eventCount: 0,
        kinds: {},
        mocked: true,
        recent: [],
      },
      events: [],
    },
  };
}

/** Backfill agile SDLC fields for older recorded fixtures. */
export function normalizeReport(report: ReleaseCheckReport): ReleaseCheckReport {
  const defaults = emptyAgileArtifacts();
  return {
    ...report,
    testGates: report.testGates ?? defaults.testGates,
    releaseNotes: report.releaseNotes ?? defaults.releaseNotes,
    rollback: report.rollback ?? defaults.rollback,
    observability: report.observability ?? defaults.observability,
  };
}

export function viewReport(desk: DeskReport): ReleaseCheckReport {
  const normalized = normalizeReport(desk.report);
  if (!desk.approvalOverlay) return normalized;

  const lead = new LeadOrchestrator({
    store: createInMemoryStore(),
    enableRemediation: false,
  });

  const baseGates = normalized.approvals.gates.map((g) => ({
    ...g,
    status: "pending" as const,
    decidedAt: undefined,
    decidedBy: undefined,
    notes: undefined,
  }));
  const base: ReleaseCheckReport = {
    ...normalized,
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

  if (decisions.length === 0) return normalized;
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
    pendingApprovals: getPendingGates(report.approvals).length,
    checkpointCount: report.checkpoints.checkpoints.length,
    prCount: report.pullRequests.pullRequests.length,
    mockIntegrations: desk.prClientMode === "mock",
  };
}

async function writeDeskReport(desk: DeskReport): Promise<void> {
  const p = await ensureDirs();
  await writeFile(
    path.join(p.reports, `${desk.runId}.json`),
    `${JSON.stringify(desk, null, 2)}\n`,
    "utf8",
  );
}

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
  return { desk, view, list: toListItem({ ...desk, report: view }) };
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

export async function startDemoScenario(
  scenarioId: string,
  mode: "live" | "fixture" = "live",
) {
  if (!isDemoScenarioId(scenarioId)) {
    throw new Error(`Unknown demo scenario: ${scenarioId}`);
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
    dmSession: nextView.dmSession,
    report: {
      ...desk.report,
      leadOutput: nextView.leadOutput,
      assessment: nextView.assessment,
    },
  };

  await writeDeskReport(updated);
  const view = viewReport(updated);
  return { desk: updated, view, list: toListItem({ ...updated, report: view }) };
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
