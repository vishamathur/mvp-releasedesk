import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createAuditEvent,
  type AuditAction,
  type AuditEvent,
  type CreateAuditEventInput,
} from "./audit.js";
import { createEvidenceItem, type CreateEvidenceInput, type EvidenceItem } from "./evidence.js";
import type { AgentRole } from "./agents/roles.js";
import {
  createRunContext,
  RunContextSchema,
  touchRun,
  type CreateRunContextInput,
  type RunContext,
} from "./run-context.js";
import {
  createTaskRecord,
  dependenciesSatisfied,
  type CreateTaskInput,
  type FailureInfo,
  type TaskRecord,
  type TaskStatus,
} from "./task.js";
import { nowIso } from "./ids.js";

export class RunContextError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RunContextError";
    this.code = code;
  }
}

export type RunContextStore = {
  create(input: CreateRunContextInput): Promise<RunContext>;
  get(runId: string): Promise<RunContext | undefined>;
  list(): Promise<RunContext[]>;
  update(runId: string, patch: Partial<Omit<RunContext, "runId" | "auditTrail">>): Promise<RunContext>;
  complete(runId: string, summary?: string): Promise<RunContext>;
  fail(runId: string, failure: { code: string; message: string }): Promise<RunContext>;
  cancel(runId: string, reason?: string): Promise<RunContext>;
  addTask(
    runId: string,
    input: Omit<CreateTaskInput, "runId">,
  ): Promise<{ run: RunContext; task: TaskRecord }>;
  updateTask(
    runId: string,
    taskId: string,
    patch: Partial<Omit<TaskRecord, "id" | "runId" | "createdAt">>,
  ): Promise<{ run: RunContext; task: TaskRecord }>;
  startTask(runId: string, taskId: string): Promise<{ run: RunContext; task: TaskRecord }>;
  completeTask(
    runId: string,
    taskId: string,
    output?: Record<string, unknown>,
  ): Promise<{ run: RunContext; task: TaskRecord }>;
  failTask(
    runId: string,
    taskId: string,
    failure: FailureInfo,
    opts?: { retry?: boolean },
  ): Promise<{ run: RunContext; task: TaskRecord }>;
  addEvidence(
    runId: string,
    taskId: string,
    evidence: CreateEvidenceInput,
  ): Promise<{ run: RunContext; task: TaskRecord; evidence: EvidenceItem }>;
  appendAudit(input: CreateAuditEventInput): Promise<AuditEvent>;
  /** Promote pending tasks whose dependencies are now satisfied. */
  refreshReadyTasks(runId: string): Promise<RunContext>;
};

function assertMutable(run: RunContext): void {
  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    throw new RunContextError(
      "run_terminal",
      `Run ${run.runId} is terminal (${run.status}) and cannot be mutated`,
    );
  }
}

function findTask(run: RunContext, taskId: string): TaskRecord {
  const task = run.tasks.find((t) => t.id === taskId);
  if (!task) {
    throw new RunContextError("task_not_found", `Task ${taskId} not found in run ${run.runId}`);
  }
  return task;
}

function replaceTask(run: RunContext, task: TaskRecord): RunContext {
  return touchRun(run, {
    tasks: run.tasks.map((t) => (t.id === task.id ? task : t)),
  });
}

function withAudit(
  run: RunContext,
  action: AuditAction,
  message: string,
  extras?: {
    taskId?: string;
    actor?: AuditEvent["actor"];
    details?: Record<string, unknown>;
  },
): { run: RunContext; event: AuditEvent } {
  const event = createAuditEvent({
    runId: run.runId,
    action,
    message,
    ...(extras?.taskId !== undefined ? { taskId: extras.taskId } : {}),
    ...(extras?.actor !== undefined ? { actor: extras.actor } : {}),
    ...(extras?.details !== undefined ? { details: extras.details } : {}),
  });
  const next = touchRun(run, {
    auditTrail: [...run.auditTrail, event],
  });
  return { run: next, event };
}

abstract class BaseRunContextStore implements RunContextStore {
  protected readonly runs = new Map<string, RunContext>();

  protected abstract persist(): Promise<void>;

  protected require(runId: string): RunContext {
    const run = this.runs.get(runId);
    if (!run) {
      throw new RunContextError("run_not_found", `Run ${runId} not found`);
    }
    return run;
  }

  protected async save(run: RunContext): Promise<RunContext> {
    this.runs.set(run.runId, run);
    await this.persist();
    return run;
  }

  async create(input: CreateRunContextInput): Promise<RunContext> {
    const created = createRunContext(input);
    const { run } = withAudit(created, "run.created", `Run created: ${created.goal}`, {
      details: { target: created.target },
    });
    return this.save(run);
  }

  async get(runId: string): Promise<RunContext | undefined> {
    return this.runs.get(runId);
  }

  async list(): Promise<RunContext[]> {
    return [...this.runs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async update(
    runId: string,
    patch: Partial<Omit<RunContext, "runId" | "auditTrail">>,
  ): Promise<RunContext> {
    const current = this.require(runId);
    assertMutable(current);
    let next = touchRun(current, patch);
    if (next.status === "created" && (patch.tasks?.length || patch.status === "running")) {
      next = touchRun(next, { status: "running" });
    }
    const audited = withAudit(next, "run.updated", "Run updated", {
      details: { keys: Object.keys(patch) },
    });
    return this.save(audited.run);
  }

  async complete(runId: string, summary?: string): Promise<RunContext> {
    const current = this.require(runId);
    assertMutable(current);
    const completed = touchRun(current, {
      status: "completed",
      completedAt: nowIso(),
      ...(summary
        ? { metadata: { ...current.metadata, completionSummary: summary } }
        : {}),
    });
    const audited = withAudit(
      completed,
      "run.completed",
      summary ?? "Run completed successfully",
    );
    return this.save(audited.run);
  }

  async fail(runId: string, failure: { code: string; message: string }): Promise<RunContext> {
    const current = this.require(runId);
    assertMutable(current);
    const failed = touchRun(current, {
      status: "failed",
      completedAt: nowIso(),
      failure,
    });
    const audited = withAudit(failed, "run.failed", failure.message, {
      details: { code: failure.code },
    });
    return this.save(audited.run);
  }

  async cancel(runId: string, reason?: string): Promise<RunContext> {
    const current = this.require(runId);
    assertMutable(current);
    const cancelled = touchRun(current, {
      status: "cancelled",
      completedAt: nowIso(),
    });
    const audited = withAudit(
      cancelled,
      "run.cancelled",
      reason ?? "Run cancelled",
    );
    return this.save(audited.run);
  }

  async addTask(
    runId: string,
    input: Omit<CreateTaskInput, "runId">,
  ): Promise<{ run: RunContext; task: TaskRecord }> {
    const current = this.require(runId);
    assertMutable(current);
    const task = createTaskRecord({ ...input, runId });
    let next = touchRun(current, {
      status: current.status === "created" ? "running" : current.status,
      tasks: [...current.tasks, task],
    });
    next = withAudit(next, "task.created", `Task created: ${task.name}`, {
      taskId: task.id,
      actor: { kind: "agent", agentRole: task.agentRole as AgentRole },
      details: { status: task.status, dependsOn: task.dependsOn },
    }).run;
    next = await this.promoteReady(next);
    const saved = await this.save(next);
    return { run: saved, task: findTask(saved, task.id) };
  }

  async updateTask(
    runId: string,
    taskId: string,
    patch: Partial<Omit<TaskRecord, "id" | "runId" | "createdAt">>,
  ): Promise<{ run: RunContext; task: TaskRecord }> {
    const current = this.require(runId);
    assertMutable(current);
    const existing = findTask(current, taskId);
    const updated: TaskRecord = {
      ...existing,
      ...patch,
      id: existing.id,
      runId: existing.runId,
      createdAt: existing.createdAt,
      updatedAt: nowIso(),
    };
    let next = replaceTask(current, updated);
    next = withAudit(next, "task.updated", `Task updated: ${updated.name}`, {
      taskId,
      details: { keys: Object.keys(patch), status: updated.status },
    }).run;
    next = await this.promoteReady(next);
    const saved = await this.save(next);
    return { run: saved, task: findTask(saved, taskId) };
  }

  async startTask(
    runId: string,
    taskId: string,
  ): Promise<{ run: RunContext; task: TaskRecord }> {
    const current = this.require(runId);
    assertMutable(current);
    const task = findTask(current, taskId);
    if (task.status !== "ready" && task.status !== "retrying" && task.status !== "pending") {
      throw new RunContextError(
        "task_not_startable",
        `Task ${taskId} cannot start from status ${task.status}`,
      );
    }
    const byId = new Map(current.tasks.map((t) => [t.id, t]));
    if (!dependenciesSatisfied(task, byId)) {
      throw new RunContextError(
        "task_dependencies_unmet",
        `Task ${taskId} has unmet dependencies`,
      );
    }
    const started: TaskRecord = {
      ...task,
      status: "running",
      startedAt: task.startedAt ?? nowIso(),
      updatedAt: nowIso(),
    };
    let next = replaceTask(
      touchRun(current, {
        status: current.status === "created" ? "running" : current.status,
      }),
      started,
    );
    next = withAudit(next, "task.started", `Task started: ${started.name}`, {
      taskId,
      actor: { kind: "agent", agentRole: started.agentRole },
    }).run;
    next = withAudit(next, "agent.invoked", `Agent invoked: ${started.agentRole}`, {
      taskId,
      actor: { kind: "agent", agentRole: started.agentRole },
    }).run;
    const saved = await this.save(next);
    return { run: saved, task: findTask(saved, taskId) };
  }

  async completeTask(
    runId: string,
    taskId: string,
    output?: Record<string, unknown>,
  ): Promise<{ run: RunContext; task: TaskRecord }> {
    const current = this.require(runId);
    assertMutable(current);
    const task = findTask(current, taskId);
    const completed: TaskRecord = {
      ...task,
      status: "completed",
      ...(output !== undefined ? { output } : {}),
      completedAt: nowIso(),
      updatedAt: nowIso(),
      failure: undefined,
    };
    let next = replaceTask(current, completed);
    next = withAudit(next, "task.completed", `Task completed: ${completed.name}`, {
      taskId,
      actor: { kind: "agent", agentRole: completed.agentRole },
    }).run;
    next = withAudit(next, "agent.completed", `Agent completed: ${completed.agentRole}`, {
      taskId,
      actor: { kind: "agent", agentRole: completed.agentRole },
    }).run;
    next = await this.promoteReady(next);
    const saved = await this.save(next);
    return { run: saved, task: findTask(saved, taskId) };
  }

  async failTask(
    runId: string,
    taskId: string,
    failure: FailureInfo,
    opts?: { retry?: boolean },
  ): Promise<{ run: RunContext; task: TaskRecord }> {
    const current = this.require(runId);
    assertMutable(current);
    const task = findTask(current, taskId);
    const wantRetry =
      opts?.retry === true ||
      (failure.retryable &&
        task.retry !== undefined &&
        task.retry.attempt + 1 < task.retry.maxAttempts);

    let status: TaskStatus = "failed";
    let retry = task.retry;
    let action: AuditAction = "task.failed";

    if (wantRetry) {
      status = "retrying";
      action = "task.retrying";
      const attempt = (task.retry?.attempt ?? 0) + 1;
      retry = {
        attempt,
        maxAttempts: task.retry?.maxAttempts ?? Math.max(attempt + 1, 3),
        lastError: failure.message,
        nextRetryAt: nowIso(),
      };
    }

    const failed: TaskRecord = {
      ...task,
      status,
      failure,
      ...(retry !== undefined ? { retry } : {}),
      updatedAt: nowIso(),
      ...(status === "failed" ? { completedAt: nowIso() } : {}),
    };

    let next = replaceTask(current, failed);
    next = withAudit(next, action, failure.message, {
      taskId,
      actor: { kind: "agent", agentRole: failed.agentRole },
      details: { code: failure.code, retryable: failure.retryable, status },
    }).run;
    next = withAudit(next, "agent.failed", `Agent failed: ${failed.agentRole}`, {
      taskId,
      actor: { kind: "agent", agentRole: failed.agentRole },
      details: { code: failure.code },
    }).run;
    const saved = await this.save(next);
    return { run: saved, task: findTask(saved, taskId) };
  }

  async addEvidence(
    runId: string,
    taskId: string,
    evidenceInput: CreateEvidenceInput,
  ): Promise<{ run: RunContext; task: TaskRecord; evidence: EvidenceItem }> {
    const current = this.require(runId);
    assertMutable(current);
    const task = findTask(current, taskId);
    const evidence = createEvidenceItem(evidenceInput);
    const updated: TaskRecord = {
      ...task,
      evidence: [...task.evidence, evidence],
      updatedAt: nowIso(),
    };
    let next = replaceTask(current, updated);
    next = withAudit(next, "evidence.added", `Evidence added: ${evidence.title}`, {
      taskId,
      details: { evidenceId: evidence.id, kind: evidence.kind },
    }).run;
    if (evidence.mock) {
      next = withAudit(
        next,
        "mock.integration_used",
        evidence.mock.note ?? `Mocked integration: ${evidence.mock.mockLabel}`,
        {
          taskId,
          details: { mockLabel: evidence.mock.mockLabel },
        },
      ).run;
    }
    const saved = await this.save(next);
    return { run: saved, task: findTask(saved, taskId), evidence };
  }

  async appendAudit(input: CreateAuditEventInput): Promise<AuditEvent> {
    const current = this.require(input.runId);
    const { run, event } = withAudit(current, input.action, input.message, {
      taskId: input.taskId,
      actor: input.actor,
      details: input.details,
    });
    // Preserve caller-supplied id/at when provided by re-building if needed.
    const finalEvent =
      input.id || input.at
        ? createAuditEvent(input)
        : event;
    const finalRun =
      finalEvent.id === event.id
        ? run
        : touchRun(current, { auditTrail: [...current.auditTrail, finalEvent] });
    await this.save(finalRun);
    return finalEvent;
  }

  async refreshReadyTasks(runId: string): Promise<RunContext> {
    const current = this.require(runId);
    assertMutable(current);
    const next = await this.promoteReady(current);
    return this.save(next);
  }

  private async promoteReady(run: RunContext): Promise<RunContext> {
    const byId = new Map(run.tasks.map((t) => [t.id, t]));
    let changed = false;
    const tasks = run.tasks.map((task) => {
      if (task.status === "pending" && dependenciesSatisfied(task, byId)) {
        changed = true;
        return { ...task, status: "ready" as const, updatedAt: nowIso() };
      }
      return task;
    });
    if (!changed) return run;
    return touchRun(run, { tasks });
  }
}

/** In-memory store — suitable for unit tests and single-process orchestration. */
export class InMemoryRunContextStore extends BaseRunContextStore {
  protected async persist(): Promise<void> {
    // no-op
  }
}

type FileStoreShape = {
  version: 1;
  runs: RunContext[];
};

/**
 * JSON file-backed store — durable across process restarts and shareable by
 * ephemeral Cursor Cloud Agents (Lead + specialists) via a common path.
 *
 * Each mutating/read op reloads from disk so concurrent agent VMs see peer
 * writes; persist is atomic (temp file + rename).
 */
export class FileBackedRunContextStore extends BaseRunContextStore {
  constructor(private readonly filePath: string) {
    super();
  }

  /** Absolute path Cloud Agents use as the shared run-context URI. */
  get storePath(): string {
    return this.filePath;
  }

  /**
   * Reload runs from disk before every operation so ephemeral Cloud Agents
   * (separate processes) share durable state. In-memory Map is a per-op cache.
   */
  private async ensureLoaded(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as FileStoreShape;
      if (parsed.version !== 1 || !Array.isArray(parsed.runs)) {
        throw new RunContextError("store_corrupt", `Invalid store format at ${this.filePath}`);
      }
      this.runs.clear();
      for (const run of parsed.runs) {
        const validated = RunContextSchema.parse(run);
        this.runs.set(validated.runId, validated);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.runs.clear();
      } else {
        throw err;
      }
    }
  }

  protected async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const payload: FileStoreShape = {
      version: 1,
      runs: [...this.runs.values()],
    };
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await rename(tmp, this.filePath);
  }

  override async create(input: CreateRunContextInput): Promise<RunContext> {
    await this.ensureLoaded();
    return super.create(input);
  }

  override async get(runId: string): Promise<RunContext | undefined> {
    await this.ensureLoaded();
    return super.get(runId);
  }

  override async list(): Promise<RunContext[]> {
    await this.ensureLoaded();
    return super.list();
  }

  override async update(
    runId: string,
    patch: Partial<Omit<RunContext, "runId" | "auditTrail">>,
  ): Promise<RunContext> {
    await this.ensureLoaded();
    return super.update(runId, patch);
  }

  override async complete(runId: string, summary?: string): Promise<RunContext> {
    await this.ensureLoaded();
    return super.complete(runId, summary);
  }

  override async fail(
    runId: string,
    failure: { code: string; message: string },
  ): Promise<RunContext> {
    await this.ensureLoaded();
    return super.fail(runId, failure);
  }

  override async cancel(runId: string, reason?: string): Promise<RunContext> {
    await this.ensureLoaded();
    return super.cancel(runId, reason);
  }

  override async addTask(
    runId: string,
    input: Omit<CreateTaskInput, "runId">,
  ): Promise<{ run: RunContext; task: TaskRecord }> {
    await this.ensureLoaded();
    return super.addTask(runId, input);
  }

  override async updateTask(
    runId: string,
    taskId: string,
    patch: Partial<Omit<TaskRecord, "id" | "runId" | "createdAt">>,
  ): Promise<{ run: RunContext; task: TaskRecord }> {
    await this.ensureLoaded();
    return super.updateTask(runId, taskId, patch);
  }

  override async startTask(
    runId: string,
    taskId: string,
  ): Promise<{ run: RunContext; task: TaskRecord }> {
    await this.ensureLoaded();
    return super.startTask(runId, taskId);
  }

  override async completeTask(
    runId: string,
    taskId: string,
    output?: Record<string, unknown>,
  ): Promise<{ run: RunContext; task: TaskRecord }> {
    await this.ensureLoaded();
    return super.completeTask(runId, taskId, output);
  }

  override async failTask(
    runId: string,
    taskId: string,
    failure: FailureInfo,
    opts?: { retry?: boolean },
  ): Promise<{ run: RunContext; task: TaskRecord }> {
    await this.ensureLoaded();
    return super.failTask(runId, taskId, failure, opts);
  }

  override async addEvidence(
    runId: string,
    taskId: string,
    evidence: CreateEvidenceInput,
  ): Promise<{ run: RunContext; task: TaskRecord; evidence: EvidenceItem }> {
    await this.ensureLoaded();
    return super.addEvidence(runId, taskId, evidence);
  }

  override async appendAudit(input: CreateAuditEventInput): Promise<AuditEvent> {
    await this.ensureLoaded();
    return super.appendAudit(input);
  }

  override async refreshReadyTasks(runId: string): Promise<RunContext> {
    await this.ensureLoaded();
    return super.refreshReadyTasks(runId);
  }
}

/** Helper for tests and callers that prefer a factory. */
export function createInMemoryStore(): InMemoryRunContextStore {
  return new InMemoryRunContextStore();
}
