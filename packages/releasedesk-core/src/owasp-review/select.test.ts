import { describe, expect, it } from "vitest";
import { addedPatch } from "./diff.js";
import { NOT_SELECTED_REASON, selectControls, selectedIds } from "./select.js";

function file(path: string, lines: readonly string[]) {
  return { path, patch: addedPatch(lines) };
}

function ids(paths: { path: string; patch: string }[]): string[] {
  return selectedIds(selectControls(paths));
}

describe("OWASP relevance selector", () => {
  it("selects auth controls, and A02 only when crypto is also present", () => {
    const auth = file("src/auth/login.ts", [
      "export function login(password: string, session: string) {",
      "  return check(password);",
      "}",
    ]);
    expect(ids([auth])).toEqual(["A01", "A07", "X01", "X03"]);
    const withHash = file("src/auth/login.ts", [
      "export function login(password: string, session: string) {",
      '  return createHash("sha256").update(password);',
      "}",
    ]);
    const chosen = selectControls([withHash]);
    expect(selectedIds(chosen)).toEqual(["A01", "A02", "A07", "X01", "X03"]);
    expect(chosen.controls.find((control) => control.id === "A02")?.rules).toEqual(["auth-crypto", "crypto"]);
  });

  it("selects injection controls for a SQL diff and not the API binding control", () => {
    const sql = file("src/db/users.ts", [
      'const rows = db.query("SELECT * FROM users WHERE id = " + req.query.id);',
    ]);
    expect(ids([sql])).toEqual(["A03", "X01", "X02"]);
  });

  it("selects only the LLM controls whose triggers match", () => {
    const llm = file("src/grok/client.ts", [
      "const promptTemplate = buildPrompt(input);",
      "await callModel({ timeoutMs: 30000, stream: true });",
      "executeTool(result.tool_calls[0]);",
    ]);
    const chosen = selectControls([llm]);
    expect(selectedIds(chosen)).toEqual(["X01", "LLM01", "LLM02", "LLM04", "LLM06", "LLM08"]);
    expect(chosen.controls.find((control) => control.id === "LLM04")?.rules).toEqual(["llm-dos"]);
    expect(chosen.controls.find((control) => control.id === "LLM08")?.rules).toEqual(["llm-agency"]);
    expect(chosen.controls.find((control) => control.id === "LLM01")?.paths).toEqual(["src/grok/client.ts"]);
  });

  it("selects dependency controls and LLM05 when an AI package is added", () => {
    const deps = file("package.json", ['{ "dependencies": { "openai": "^4.0.0" } }']);
    const chosen = selectControls([deps]);
    expect(selectedIds(chosen)).toEqual(["A06", "A08", "X01", "LLM05"]);
    expect(chosen.controls.find((control) => control.id === "LLM05")?.rules).toEqual(["llm-supply-chain"]);
  });

  it("selects only X01 for a docs-only diff, even when the prose mentions auth", () => {
    const docs = file("docs/guide.md", ["This note mentions password, jwt, and a database query."]);
    const chosen = selectControls([docs]);
    expect(chosen.docsOnly).toBe(true);
    expect(selectedIds(chosen)).toEqual(["X01"]);
    const access = chosen.controls.find((control) => control.id === "A07");
    expect(access?.selected).toBe(false);
    expect(access?.rules).toEqual([]);
    const floor = chosen.controls.find((control) => control.id === "X01");
    expect(floor?.rules).toEqual(["secrets-floor"]);
    expect(floor?.paths).toEqual(["docs/guide.md"]);
    expect(NOT_SELECTED_REASON).toBe("not selected: no matching change");
  });

  it("unions rules on a mixed diff and records the matching paths", () => {
    const docs = file("docs/guide.md", ["See the guide."]);
    const auth = file("src/auth/login.ts", [
      "export function login(password: string, session: string) {",
      "  return check(password);",
      "}",
    ]);
    const deps = file("package.json", ['{ "dependencies": { "openai": "^4.0.0" } }']);
    const chosen = selectControls([docs, auth, deps]);
    expect(chosen.docsOnly).toBe(false);
    expect(selectedIds(chosen)).toEqual(["A01", "A06", "A07", "A08", "X01", "X03", "LLM05"]);
    expect(chosen.controls.find((control) => control.id === "X01")?.paths).toEqual([
      "docs/guide.md",
      "package.json",
      "src/auth/login.ts",
    ]);
    expect(chosen.controls.find((control) => control.id === "A07")?.paths).toEqual(["src/auth/login.ts"]);
    expect(chosen.controls.find((control) => control.id === "A07")?.rules).toContain("auth");
  });

  it("does not treat max_tokens on a non-LLM file as an auth or LLM control", () => {
    const limits = file("src/limits.ts", ["const max_tokens = 100;"]);
    expect(ids([limits])).toEqual(["X01"]);
  });
});
