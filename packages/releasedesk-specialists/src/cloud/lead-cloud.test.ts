import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileBackedRunContextStore } from "@releasedesk/core";
import { createMockPrClient } from "@releasedesk/lead";
import { createMockCloudAgentClient } from "./mock-client.js";
import { createSharedRunContextStore, startLeadCloudAgent } from "./lead-cloud.js";
import { createCloudSpecialistRunners } from "./cloud-runners.js";
import { ORCHESTRATION_CLOUD_AGENT_KINDS, SPECIALIST_CLOUD_AGENT_KINDS } from "./types.js";

describe("Lead + specialists as Cloud Agents (MOCK, on-demand)", () => {
  it("dispatches ephemeral Lead Cloud Agent then specialists via shared file store", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rd-lead-cloud-"));
    const storePath = path.join(dir, "runs.json");
    const store = createSharedRunContextStore(storePath);
    const client = createMockCloudAgentClient();

    const started = await startLeadCloudAgent({
      store,
      storeUri: store.storePath,
      cloudClient: client,
      specialists: {
        cloudClient: client,
        storeUri: store.storePath,
        skipGrok: true,
        workspaceRoot: path.resolve(process.cwd(), "../.."),
      },
      lead: {
        enableRemediation: false,
        maxRemediationCycles: 0,
        prClient: { client: createMockPrClient() },
      },
      check: {
        goal: "On-demand Lead Cloud Agent check",
        target: {
          repository: "vishamathur/mvp-releasedesk",
          baseRef: "main",
          headRef: "HEAD",
        },
        trigger: { requestedBy: "desk-ui-test" },
      },
    });

    expect(started.triggerKind).toBe("on_demand");
    expect(started.cloudClientMode).toBe("mock");
    expect(started.leadCloud.agentKind).toBe("lead");
    expect(started.leadCloud.mocked).toBe(true);
    expect(started.leadCloud.cloudAgentId).toMatch(/^bc-mock-lead-/);
    expect(started.storeUri).toBe(storePath);

    expect(started.report.run.metadata.trigger).toMatchObject({ kind: "on_demand" });
    expect(started.report.run.metadata.leadRuntime).toBe("cursor_cloud_agent");
    expect(started.report.run.metadata.noScheduler).toBe(true);
    expect(started.report.run.metadata.triggerSource).toBe("desk_ui_on_demand");
    expect(started.report.run.metadata.sharedStoreUri).toBe(storePath);
    expect(started.report.run.metadata.leadCloudAgentId).toBe(started.leadCloud.cloudAgentId);

    // Specialists recorded as cloud-backed (ephemeralCloudAgent on payloads).
    const specialistTasks = started.report.run.tasks.filter((t) =>
      (SPECIALIST_CLOUD_AGENT_KINDS as readonly string[]).includes(String(t.agentRole)),
    );
    expect(specialistTasks.length).toBeGreaterThan(0);
    const completedWithCloud = specialistTasks.filter(
      (t) =>
        t.status === "completed" &&
        t.output &&
        (t.output as { ephemeralCloudAgent?: boolean }).ephemeralCloudAgent === true,
    );
    expect(completedWithCloud.length).toBeGreaterThan(0);

    // Durable store visible to a second process/instance.
    const peer = new FileBackedRunContextStore(storePath);
    const loaded = await peer.get(started.report.runId);
    expect(loaded?.runId).toBe(started.report.runId);
    expect(loaded?.metadata.leadRuntime).toBe("cursor_cloud_agent");
  });

  it("cloud specialist runners dispatch orchestration kinds through CloudAgentClient", async () => {
    const client = createMockCloudAgentClient();
    const runners = createCloudSpecialistRunners({
      cloudClient: client,
      skipGrok: true,
      storeUri: "/tmp/rd-shared-runs.json",
      executeLocalAnalysisInMock: false,
    });

    const { createInMemoryStore } = await import("@releasedesk/core");
    const store = createInMemoryStore();
    const run = await store.create({
      goal: "unit",
      target: { repository: "vishamathur/mvp-releasedesk" },
      metadata: { sharedStoreUri: "/tmp/rd-shared-runs.json" },
    });
    const { task } = await store.addTask(run.runId, {
      name: "Change analysis",
      agentRole: "change_analyst",
      status: "ready",
    });
    await store.startTask(run.runId, task.id);
    const fresh = await store.get(run.runId);
    const result = await runners.change_analyst({
      runId: run.runId,
      taskId: task.id,
      agentRole: "change_analyst",
      attempt: 1,
      run: fresh!,
      task: fresh!.tasks.find((t) => t.id === task.id)!,
    });

    expect(result.status).toBe("completed");
    expect(result.payload.ephemeralCloudAgent).toBe(true);
    expect(result.payload.cloudAgentApi).toBe("mock");
    expect(String(result.payload.cloudAgentId)).toMatch(/^bc-mock-change_analyst-/);
  });

  it("exposes orchestration cloud agent kinds including Lead", () => {
    expect(ORCHESTRATION_CLOUD_AGENT_KINDS).toContain("lead");
    expect(ORCHESTRATION_CLOUD_AGENT_KINDS).toEqual(
      expect.arrayContaining([
        "lead",
        "change_analyst",
        "standards",
        "security",
        "builder",
        "ai_red_teaming",
      ]),
    );
  });
});
