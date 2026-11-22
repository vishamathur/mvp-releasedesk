import { describe, expect, it } from "vitest";
import { createInMemoryStore, MANDATORY_SECURITY_ROLE, MissingCredentialError } from "@releasedesk/core";
import type { AgentRunInvocation } from "@releasedesk/lead";
import { createSecurityRunner } from "./security.js";
import { correlateAdvisories, loadAdvisoryCorpus } from "./advisories.js";
import { defaultWorkspaceRoot, sampleAdvisoriesPath } from "./paths.js";
import { createSpecialistRunners, DEFAULT_SPECIALIST_ROLES } from "./runners.js";

async function invocation(
  input: Record<string, unknown>,
): Promise<AgentRunInvocation> {
  const store = createInMemoryStore();
  const run = await store.create({
    goal: "test",
    target: { repository: "vishamathur/mvp-releasedesk" },
  });
  const { task } = await store.addTask(run.runId, {
    name: "Security review",
    agentRole: "security",
    status: "running",
    input,
  });
  return {
    runId: run.runId,
    taskId: task.id,
    agentRole: "security",
    attempt: 0,
    run: (await store.get(run.runId))!,
    task,
  };
}

describe("default specialist set", () => {
  it("always includes Security runner (mandatory on every change)", () => {
    expect(DEFAULT_SPECIALIST_ROLES).toContain(MANDATORY_SECURITY_ROLE);
    const runners = createSpecialistRunners();
    expect(typeof runners.security).toBe("function");
    expect(Object.keys(runners).sort()).toEqual(
      ["builder", "change_analyst", "security", "standards"].sort(),
    );
  });
});

describe("SecurityRunner", () => {
  it("fails clearly when the Security Grok key is missing", async () => {
    const runner = createSecurityRunner({
      workspaceRoot: defaultWorkspaceRoot(),
    });
    const inv = await invocation({
      repository: "vishamathur/mvp-releasedesk",
      components: [],
    });
    await expect(runner(inv)).rejects.toBeInstanceOf(MissingCredentialError);
  });

  it("correlateAdvisories respects version ranges", async () => {
    const corpus = await loadAdvisoryCorpus(sampleAdvisoriesPath());
    const hits = correlateAdvisories(corpus.advisories, [
      { name: "evil-lib", version: "9.9.9" },
    ]);
    expect(hits.some((h) => h.packageName === "evil-lib")).toBe(false);

    const vulnerable = correlateAdvisories(corpus.advisories, [
      { name: "evil-lib", version: "1.2.3" },
    ]);
    expect(vulnerable.some((h) => h.packageName === "evil-lib")).toBe(true);
  });
});
