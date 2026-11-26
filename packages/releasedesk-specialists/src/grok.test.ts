import { describe, expect, it } from "vitest";
import { grokComplete } from "./grok.js";

function capture(): { fetchImpl: typeof fetch; model: () => unknown } {
  let model: unknown;
  const fetchImpl: typeof fetch = async (_url, init) => {
    model = (JSON.parse(String(init?.body)) as { model?: unknown }).model;
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  };
  return { fetchImpl, model: () => model };
}

describe("grokComplete model", () => {
  it("defaults to grok-4.3 and honours GROK_MODEL", async () => {
    const a = capture();
    await grokComplete("hi", { apiKey: "k", fetchImpl: a.fetchImpl, env: {} });
    expect(a.model()).toBe("grok-4.3");
    const b = capture();
    await grokComplete("hi", { apiKey: "k", fetchImpl: b.fetchImpl, env: { GROK_MODEL: "grok-4.7" } });
    expect(b.model()).toBe("grok-4.7");
    const c = capture();
    await grokComplete("hi", { apiKey: "k", fetchImpl: c.fetchImpl, env: { GROK_MODEL: " " } });
    expect(c.model()).toBe("grok-4.3");
  });
});
