import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryStore, MissingCredentialError } from "@releasedesk/core";
import type { AgentRunInvocation } from "@releasedesk/lead";
import { createChangeAnalystRunner } from "./change-analyst.js";

function gitRange(): { root: string; base: string; head: string } {
  const root = mkdtempSync(path.join(tmpdir(), "rd-git-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(path.join(root, "note.txt"), "one\n");
  git("add", "note.txt");
  git("commit", "-m", "one");
  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  writeFileSync(path.join(root, "note.txt"), "two\n");
  git("add", "note.txt");
  git("commit", "-m", "two");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  return { root, base, head };
}

async function invocation(
  input: Record<string, unknown>,
): Promise<AgentRunInvocation> {
  const store = createInMemoryStore();
  const run = await store.create({
    goal: "test",
    target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main", headRef: "HEAD" },
  });
  const { task } = await store.addTask(run.runId, {
    name: "Change analysis",
    agentRole: "change_analyst",
    status: "running",
    input,
  });
  const started = await store.get(run.runId);
  return {
    runId: run.runId,
    taskId: task.id,
    agentRole: "change_analyst",
    attempt: 0,
    run: started!,
    task,
  };
}

describe("ChangeAnalystRunner", () => {
  it("analyzes local git range and returns evidence-backed findings", async () => {
    const range = gitRange();
    const runner = createChangeAnalystRunner({
      workspaceRoot: range.root,
    });
    const inv = await invocation({
      repository: "vishamathur/mvp-releasedesk",
      baseRef: range.base,
      headRef: range.head,
      focusPaths: [],
    });

    await expect(runner(inv)).rejects.toBeInstanceOf(MissingCredentialError);
  });

  it("refuses to invent a change set when git yields nothing", async () => {
    const runner = createChangeAnalystRunner({
      workspaceRoot: "/tmp/nonexistent-releasedesk-workspace",
    });
    const inv = await invocation({
      repository: "vishamathur/mvp-releasedesk",
      baseRef: "main",
      headRef: "HEAD",
    });

    await expect(runner(inv)).rejects.toThrow(/Refusing to invent a change set/);
  });
});
