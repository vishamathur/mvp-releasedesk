import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../.github/workflows/owasp-review.yml",
);

describe("owasp-review workflow", () => {
  const yaml = readFileSync(workflowPath, "utf8");
  const onBlock = yaml.slice(yaml.indexOf("\non:"), yaml.indexOf("\npermissions:"));

  it("runs on every pull request that targets main", () => {
    expect(onBlock).toContain("pull_request:");
    expect(onBlock).toContain("opened");
    expect(onBlock).toContain("synchronize");
    expect(onBlock).toContain("reopened");
    expect(onBlock).toContain("main");
    expect(onBlock).not.toContain("paths:");
    expect(onBlock).not.toContain("labels:");
    expect(onBlock).not.toMatch(/branches-ignore|REQ-/);
  });

  it("reads the Security key and falls back to the Lead key in the job environment", () => {
    expect(yaml).toContain("RELEASEDESK_GROK_API_KEY_SECURITY:");
    expect(yaml).toContain("RELEASEDESK_GROK_API_KEY_LEAD:");
    expect(yaml).not.toMatch(/if:\s*\$\{\{\s*secrets/);
    expect(yaml).toContain("scripts/owasp-review-pr.ts --comment");
  });
});
