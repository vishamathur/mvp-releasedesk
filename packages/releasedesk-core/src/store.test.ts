import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { nowIso } from "./ids.js";
import { createMockMeta } from "./mock.js";
import {
  createInMemoryStore,
  FileBackedRunContextStore,
  RunContextError,
} from "./store.js";

describe("InMemoryRunContextStore lifecycle", () => {
  it("create → update → complete with unique run ids and audit trail", async () => {
    const store = createInMemoryStore();
    const runA = await store.create({
      goal: "Release check A",
      target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main" },
    });
    const runB = await store.create({
      goal: "Release check B",
      target: { repository: "vishamathur/mvp-releasedesk", headRef: "feature" },
    });

    expect(runA.runId).not.toBe(runB.runId);
    expect(runA.runId).toMatch(/^run_/);
    expect(runA.status).toBe("created");
    expect(runA.auditTrail[0]?.action).toBe("run.created");

    const updated = await store.update(runA.runId, {
      metadata: { trigger: "on_demand" },
      status: "running",
    });
    expect(updated.status).toBe("running");
    expect(updated.auditTrail.some((e) => e.action === "run.updated")).toBe(true);

    const completed = await store.complete(runA.runId, "All specialists green");
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).toBeTruthy();
    expect(completed.metadata.completionSummary).toBe("All specialists green");
    expect(completed.auditTrail.at(-1)?.action).toBe("run.completed");

    await expect(store.update(runA.runId, { goal: "nope" })).rejects.toBeInstanceOf(
      RunContextError,
    );
  });

  it("fail path records failure and blocks further mutation", async () => {
    const store = createInMemoryStore();
    const run = await store.create({
      goal: "Will fail",
      target: { repository: "vishamathur/mvp-releasedesk" },
    });
    const failed = await store.fail(run.runId, {
      code: "orchestrator_error",
      message: "Lead agent crashed",
    });
    expect(failed.status).toBe("failed");
    expect(failed.failure?.code).toBe("orchestrator_error");
    expect(failed.auditTrail.at(-1)?.action).toBe("run.failed");
    await expect(store.addTask(run.runId, { name: "x", agentRole: "lead" })).rejects.toMatchObject({
      code: "run_terminal",
    });
  });

  it("task start/complete/fail/retry + evidence and mock audit hooks", async () => {
    const store = createInMemoryStore();
    const run = await store.create({
      goal: "Parallel specialists",
      target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main" },
    });

    const { task: changeTask } = await store.addTask(run.runId, {
      name: "Change analysis",
      agentRole: "change_analyst",
      retry: { attempt: 0, maxAttempts: 3 },
    });
    const { task: standardsTask } = await store.addTask(run.runId, {
      name: "Standards check",
      agentRole: "standards",
      dependsOn: [changeTask.id],
    });

    expect(changeTask.status).toBe("ready");
    expect(standardsTask.status).toBe("pending");

    const started = await store.startTask(run.runId, changeTask.id);
    expect(started.task.status).toBe("running");
    expect(started.run.auditTrail.some((e) => e.action === "agent.invoked")).toBe(true);

    const withEvidence = await store.addEvidence(run.runId, changeTask.id, {
      kind: "diff",
      title: "Mocked GitHub diff",
      summary: "Synthetic diff for tests",
      source: "change_analyst",
      mock: createMockMeta("github-api", "no GitHub token available"),
    });
    expect(withEvidence.evidence.mock?.mocked).toBe(true);
    expect(
      withEvidence.run.auditTrail.some((e) => e.action === "mock.integration_used"),
    ).toBe(true);

    const failedOnce = await store.failTask(
      run.runId,
      changeTask.id,
      {
        code: "upstream_timeout",
        message: "GitHub timed out",
        retryable: true,
        failedAt: nowIso(),
      },
    );
    expect(failedOnce.task.status).toBe("retrying");
    expect(failedOnce.task.retry?.attempt).toBe(1);
    expect(failedOnce.run.auditTrail.some((e) => e.action === "task.retrying")).toBe(true);

    await store.startTask(run.runId, changeTask.id);
    await store.completeTask(run.runId, changeTask.id, {
      overallImpact: "low",
    });

    const refreshed = await store.get(run.runId);
    const standards = refreshed?.tasks.find((t) => t.id === standardsTask.id);
    expect(standards?.status).toBe("ready");

    await store.startTask(run.runId, standardsTask.id);
    await store.completeTask(run.runId, standardsTask.id);

    const terminalFail = await store.addTask(run.runId, {
      name: "Security",
      agentRole: "security",
      retry: { attempt: 2, maxAttempts: 3 },
    });
    const hardFail = await store.failTask(
      run.runId,
      terminalFail.task.id,
      {
        code: "parse_error",
        message: "Unrecoverable",
        retryable: false,
        failedAt: nowIso(),
      },
    );
    expect(hardFail.task.status).toBe("failed");
  });

  it("rejects starting a task with unmet dependencies", async () => {
    const store = createInMemoryStore();
    const run = await store.create({
      goal: "Deps",
      target: { repository: "vishamathur/mvp-releasedesk" },
    });
    const { task: a } = await store.addTask(run.runId, {
      name: "A",
      agentRole: "change_analyst",
    });
    const { task: b } = await store.addTask(run.runId, {
      name: "B",
      agentRole: "standards",
      dependsOn: [a.id],
    });
    await expect(store.startTask(run.runId, b.id)).rejects.toMatchObject({
      code: "task_dependencies_unmet",
    });
  });
});

describe("FileBackedRunContextStore", () => {
  it("persists create/complete across instances", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rd-core-"));
    const filePath = path.join(dir, "runs.json");

    const store1 = new FileBackedRunContextStore(filePath);
    const created = await store1.create({
      goal: "Durable run",
      target: { repository: "vishamathur/mvp-releasedesk" },
    });
    await store1.complete(created.runId, "done");

    const raw = await readFile(filePath, "utf8");
    expect(raw).toContain(created.runId);

    const store2 = new FileBackedRunContextStore(filePath);
    const loaded = await store2.get(created.runId);
    expect(loaded?.status).toBe("completed");
    expect(loaded?.auditTrail.some((e) => e.action === "run.completed")).toBe(true);
  });
});
