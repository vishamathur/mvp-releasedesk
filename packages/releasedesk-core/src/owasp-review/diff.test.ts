import { describe, expect, it } from "vitest";
import { addedPatch, partitionGrounded, renderDiffSlices } from "./diff.js";

describe("owasp diff grounding and slices", () => {
  it("grounds evidence joined across consecutive changed lines", () => {
    const lines = [
      "  const sql =",
      `    "SELECT id FROM users WHERE name = '" + username + "'";`,
    ];
    const evidence = `const sql = "SELECT id FROM users WHERE name = '" + username + "'";`;
    const result = partitionGrounded(
      [{ id: "A03", path: "src/query.ts", line: 2, evidence, severity: "high" }],
      [{ path: "src/query.ts", patch: addedPatch(lines) }],
    );
    expect(result.dropped).toEqual([]);
    expect(result.grounded).toEqual([
      { id: "A03", path: "src/query.ts", line: 2, evidence, severity: "high" },
    ]);
  });

  it("splits a diff by file instead of dropping files", () => {
    const files = ["a.ts", "b.ts", "c.ts"].map((path) => ({
      path,
      patch: addedPatch(["x".repeat(2000)]),
    }));
    const plan = renderDiffSlices(files, 400);
    expect(plan.truncated).toBe(false);
    expect(plan.filesSent).toBe(3);
    expect(plan.filesTotal).toBe(3);
    expect(plan.slices.length).toBeGreaterThan(1);
    const sent = plan.slices.map((slice) => slice.text).join("\n");
    for (const path of ["a.ts", "b.ts", "c.ts"]) expect(sent).toContain(`a/${path}`);
  });
});
