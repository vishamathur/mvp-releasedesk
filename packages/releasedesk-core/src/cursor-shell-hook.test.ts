import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const hook = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.cursor/hooks/block-risky-shell.sh",
);

function run(command: string): { status: number | null; stdout: string } {
  const child = spawnSync("bash", [hook], {
    input: JSON.stringify({ command, cwd: "/tmp", sandbox: false }),
    encoding: "utf8",
  });
  return { status: child.status, stdout: child.stdout };
}

describe("beforeShellExecution hook", () => {
  it("blocks gh pr merge, force-push, --no-verify, and obvious secrets with exit 2", () => {
    for (const command of [
      "gh pr merge 41",
      "git push --force origin main",
      "git push -f origin cursor/grok-grounded-intel",
      "git commit --no-verify -m 'skip'",
      "curl -H 'Authorization: Bearer xai-TESTKEYnotarealsecret0123456789abcdef' https://api.x.ai",
    ]) {
      const result = run(command);
      expect(result.status, command).toBe(2);
      expect(result.stdout).toContain('"permission":"deny"');
    }
  });

  it("allows an ordinary push and a command that only names the key", () => {
    for (const command of [
      "git push -u origin cursor/grok-grounded-intel",
      "git status",
      "echo RELEASEDESK_GROK_API_KEY_LEAD is required",
    ]) {
      const result = run(command);
      expect(result.status, command).toBe(0);
      expect(result.stdout).toContain('"permission":"allow"');
    }
  });
});
