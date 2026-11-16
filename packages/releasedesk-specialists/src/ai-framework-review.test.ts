import { describe, expect, it } from "vitest";
import {
  detectAiSurface,
  reviewAiSurfaceAgainstFrameworks,
  enforceFrameworkHardFail,
} from "./ai-framework-review.js";
import { createSecurityRunner } from "./security.js";
import { createInMemoryStore } from "@releasedesk/core";
import type { AgentRunInvocation } from "@releasedesk/lead";
import { defaultWorkspaceRoot } from "./paths.js";

describe("AI framework review (ATLAS / OWASP LLM Top 10)", () => {
  it("emits hard-fail findings for AI surfaces", () => {
    const findings = reviewAiSurfaceAgainstFrameworks({
      components: [{ name: "openai", version: "4.0.0" }],
      aiWrittenCodeDetected: true,
      focusPaths: ["packages/releasedesk-specialists/src/grok.ts"],
    });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.hardFail && f.releaseBlocking)).toBe(true);
    expect(findings.every((f) => f.frameworkMappings.length > 0)).toBe(true);
    expect(
      findings.some((f) =>
        f.frameworkMappings.some((m) => m.framework === "owasp_llm_top_10"),
      ),
    ).toBe(true);
    expect(
      findings.some((f) => f.frameworkMappings.some((m) => m.framework === "mitre_atlas")),
    ).toBe(true);
  });

  it("returns no framework findings when no AI surface", () => {
    expect(
      reviewAiSurfaceAgainstFrameworks({
        components: [{ name: "next", version: "16.0.0" }],
        aiWrittenCodeDetected: false,
      }),
    ).toHaveLength(0);
  });

  it("detects AI-related paths and packages", () => {
    const surface = detectAiSurface({
      components: [{ name: "langchain" }],
      focusPaths: ["apps/agent/prompt.ts"],
    });
    expect(surface.aiWrittenCodeDetected).toBe(true);
    expect(surface.aiComponents.length).toBe(1);
  });

  it("Security runner fails check when AI hints provided", async () => {
    const store = createInMemoryStore();
    const run = await store.create({
      goal: "AI framework hard fail",
      target: { repository: "vishamathur/mvp-releasedesk" },
    });
    const { task } = await store.addTask(run.runId, {
      name: "Security review",
      agentRole: "security",
      status: "running",
      input: {
        repository: "vishamathur/mvp-releasedesk",
        components: [],
        aiComponentHints: ["packages/releasedesk-specialists/src/grok.ts"],
        aiWrittenCodeDetected: true,
      },
    });
    const inv: AgentRunInvocation = {
      runId: run.runId,
      taskId: task.id,
      agentRole: "security",
      attempt: 0,
      run: (await store.get(run.runId))!,
      task,
    };
    const result = await createSecurityRunner({
      workspaceRoot: defaultWorkspaceRoot(),
      skipGrok: true,
    })(inv);

    expect(result.payload.securityCheckFailed).toBe(true);
    expect((result.payload.frameworkHardFailCount as number) > 0).toBe(true);
    const findings = result.payload.findings as Array<{
      frameworkMappings: unknown[];
      hardFail: boolean;
      releaseBlocking: boolean;
    }>;
    const mapped = findings.filter((f) => f.frameworkMappings.length > 0);
    expect(mapped.length).toBeGreaterThan(0);
    expect(mapped.every((f) => f.hardFail && f.releaseBlocking)).toBe(true);
    expect(enforceFrameworkHardFail(mapped[0]!).releaseBlocking).toBe(true);
  });
});
