import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryStore } from "@releasedesk/core";
import { LeadOrchestrator, getPendingGates } from "@releasedesk/lead";
import { createSpecialistRunners } from "./runners.js";

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

describe("Lead + specialist runners integration", () => {
  it("runs real specialists through Lead and records independent task results", async () => {
    const range = gitRange();
    const store = createInMemoryStore();
    const runners = createSpecialistRunners({
      workspaceRoot: range.root,
      skipGrok: true,
      assumeLeadHumanGates: true,
    });

    const lead = new LeadOrchestrator({
      store,
      runners,
      enableRemediation: false,
    });

    const report = await lead.startOnDemandCheck({
      goal: "M4 integration — specialist agents",
      target: {
        repository: "vishamathur/mvp-releasedesk",
        baseRef: range.base,
        headRef: range.head,
      },
      trigger: { requestedBy: "integration-test" },
    });

    expect(report.run.status).toBe("completed");
    expect(report.leadOutput.readiness).toBe("needs_human");
    expect(getPendingGates(report.approvals).length).toBe(2);

    const specialists = report.run.tasks.filter((t) => t.agentRole !== "lead");
    expect(specialists.length).toBeGreaterThanOrEqual(3);
    expect(specialists.every((t) => t.status === "completed")).toBe(true);

    const byRole = Object.fromEntries(specialists.map((t) => [t.agentRole, t]));
    expect(byRole.change_analyst?.output?.releaseNotesDraft).toBeTruthy();
    expect(Array.isArray(byRole.change_analyst?.output?.findings)).toBe(true);
    expect(byRole.change_analyst?.evidence.length).toBeGreaterThan(0);

    expect(byRole.standards?.output?.compliant).toBe(true);
    expect(byRole.standards?.evidence.some((e) => e.kind === "policy_ref")).toBe(true);

    expect(byRole.security?.output?.releaseBlockingCount).toBe(0);
    expect(byRole.security?.evidence.some((e) => e.mock?.mocked)).toBe(true);

    // Not empty stub summaries
    expect(String(byRole.change_analyst?.output?.summary ?? "")).not.toMatch(/stub/i);
    expect(String(byRole.standards?.output?.summary ?? "")).not.toMatch(/stub/i);

    const actions = new Set(report.run.auditTrail.map((e) => e.action));
    expect(actions.has("task.completed")).toBe(true);
    expect(actions.has("human.approval_requested")).toBe(true);
  });
});
