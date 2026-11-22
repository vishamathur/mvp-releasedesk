import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertGrokChatStatus,
  buildGrokChatCompletionBody,
  GROK_GUIDELINES,
  GrokGuidelineError,
  hashSafetyIdentifier,
} from "./grok-guardrails.js";
import { buildGuardrailProbeBody, GROK_GUARDRAIL_PROBES } from "./ai-red-teaming/grok-guardrails-provider.js";

describe("Grok chat completion guardrails", () => {
  it("hashes an internal id and does not accept an empty source", () => {
    const expected = createHash("sha256").update("request-1", "utf8").digest("hex");
    expect(hashSafetyIdentifier("  request-1  ")).toBe(expected);
    expect(hashSafetyIdentifier("request-1")).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSafetyIdentifier("request-1")).not.toContain("request-1");
    expect(() => hashSafetyIdentifier("  ")).toThrow(/empty/);
  });

  it("puts guidelines and a hashed safety_identifier on the body and omits stop and n", () => {
    const body = buildGrokChatCompletionBody({
      model: "grok-3",
      safetySource: "lead:vishamathur/mvp-releasedesk",
      temperature: 0.1,
      messages: [
        { role: "system", content: "Return JSON only." },
        { role: "user", content: "classify this change" },
      ],
    });

    expect(body.guidelines).toEqual(GROK_GUIDELINES);
    expect(body.safety_identifier).toBe(
      hashSafetyIdentifier("lead:vishamathur/mvp-releasedesk"),
    );
    expect(body).not.toHaveProperty("stop");
    expect(body).not.toHaveProperty("n");
    expect(JSON.stringify(body)).not.toMatch(/@/);
  });

  it("rejects a multi-agent model", () => {
    expect(() =>
      buildGrokChatCompletionBody({
        model: "grok-4.20-multi-agent",
        safetySource: "security",
        messages: [{ role: "user", content: "ping" }],
      }),
    ).toThrow(/cannot be used with guidelines/);
  });

  it("treats 400 and 422 as guideline failures", () => {
    expect(() => assertGrokChatStatus(400)).toThrow(GrokGuidelineError);
    expect(() => assertGrokChatStatus(422)).toThrow(/Refusing to continue/);
    expect(() => assertGrokChatStatus(200)).not.toThrow();
    expect(() => assertGrokChatStatus(503)).not.toThrow();
  });

  it("builds each guardrail probe with the shared guidelines", () => {
    for (const probe of GROK_GUARDRAIL_PROBES) {
      const body = buildGuardrailProbeBody(probe, "security:northwind");
      expect(body.guidelines).toEqual(GROK_GUIDELINES);
      expect(body.safety_identifier).toBe(hashSafetyIdentifier("security:northwind"));
      expect(body.model).toBe("grok-3");
      expect(body).not.toHaveProperty("stop");
      expect(body).not.toHaveProperty("n");
    }
    expect(GROK_GUARDRAIL_PROBES.map((probe) => probe.id)).toEqual([
      "prompt-injection",
      "secret-exfiltration",
      "policy-bypass",
      "unsafe-content",
    ]);
  });
});
