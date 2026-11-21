import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listGrokBotDefinitions } from "./load.js";
import {
  NC_PREFIX_STAGE_IDS,
  SHARED_STAGE_IDS,
  assertSharedSpine,
  listProcessDefinitions,
} from "./processes.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

describe("PID specs and Grok Bot packs", () => {
  it("loads PID-ER and PID-NC as versioned specs with the shared spine", async () => {
    const defs = await listProcessDefinitions(workspaceRoot);
    expect(defs.map((d) => d.id)).toEqual(["PID-ER", "PID-NC"]);
    const er = defs.find((d) => d.id === "PID-ER")!;
    const nc = defs.find((d) => d.id === "PID-NC")!;
    expect(er.version).toBe("1.0.0");
    expect(nc.version).toBe("1.0.0");
    expect(er.cadence.kind).toBe("fixed_sprint");
    expect(nc.cadence.kind).toBe("kickoff_first");
    expect(er.entry.channel).toBe("#er-intake");
    expect(nc.entry.channel).toBe("#new-customer");
    assertSharedSpine(er);
    assertSharedSpine(nc);
    expect(er.stages.map((s) => s.id)).toEqual([...SHARED_STAGE_IDS]);
    expect(nc.stages.map((s) => s.id)).toEqual([
      "intake",
      ...NC_PREFIX_STAGE_IDS,
      "estimation",
      "finance-approval",
      "security-compliance-approval",
      "build",
      "test-gate",
      "release-gate",
    ]);
    for (const def of defs) {
      expect(def.botsMayAutoApprove).toBe(false);
      expect(def.securityMandatory).toBe(true);
      expect(def.iterationGate).toBe("red_team|security");
      for (const stage of def.stages) {
        expect(stage.autoApprove).toBe(false);
      }
    }
    const human = (id: string, stage: string) =>
      defs.find((d) => d.id === id)!.stages.find((s) => s.id === stage)!.humanApprover;
    expect(human("PID-ER", "finance-approval")).toBe("Finance partner");
    expect(human("PID-ER", "security-compliance-approval")).toMatch(/Security officer/);
    expect(human("PID-ER", "release-gate")).toBe("Release manager");
    expect(human("PID-ER", "estimation")).toBeNull();
    expect(human("PID-NC", "proposal")).toBe("Customer sponsor");
    expect(nc.stages.find((s) => s.id === "estimation")!.consulting).toEqual([
      "builder",
      "security",
      "standards",
    ]);
    expect(er.stages.find((s) => s.id === "estimation")!.consulting).toEqual(["standards"]);
  });

  it("gives every bot a playbook, a prompt, channels, and no API key", async () => {
    const defs = await listGrokBotDefinitions(workspaceRoot);
    expect(defs.map((d) => d.id)).toEqual([
      "lead",
      "change-analyst",
      "standards",
      "security",
      "builder",
    ]);
    for (const def of defs) {
      expect(def.mayAutoApproveHumanGate).toBe(false);
      expect("apiKeyEnv" in def).toBe(false);
      expect(def.memoryKeys.length).toBeGreaterThan(0);
      expect(def.channels.some((c) => c.posts) || def.channels.some((c) => c.listens)).toBe(
        true,
      );
      for (const skill of def.skills) {
        const body = await readFile(path.join(workspaceRoot, skill.playbook), "utf8");
        expect(body.length).toBeGreaterThan(40);
      }
      for (const routine of def.routines) {
        expect(routine.prompt.length).toBeGreaterThan(20);
        const body = await readFile(path.join(workspaceRoot, routine.playbook), "utf8");
        expect(body).toContain(routine.name);
      }
    }
    const security = defs.find((d) => d.id === "security")!;
    expect(security.mandatoryOnEveryChange).toBe(true);
    const builder = defs.find((d) => d.id === "builder")!;
    expect(builder.skills.map((s) => s.name)).toContain("launch-cursor-coding-agent");
    expect(builder.handoffs.some((h) => h.messageKind === "build-result" && h.to === "lead")).toBe(
      true,
    );
    const launch = await readFile(
      path.join(workspaceRoot, "grok-bots/bots/builder/skills/launch-cursor-coding-agent.md"),
      "utf8",
    );
    expect(launch).toContain(".cursor/rules/releasedesk-grok-api.mdc");
    expect(launch).toContain(".cursor/skills/ship-grok-release-intel/SKILL.md");
    expect(launch).toContain("XAI_API_KEY");
    expect(launch).toContain("json_schema");
  });
});
