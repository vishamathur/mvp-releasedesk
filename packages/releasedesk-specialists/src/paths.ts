import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Package root (`packages/releasedesk-specialists`). Works from `src/` (tsx) or `dist/`. */
export function packageRoot(): string {
  return path.resolve(here, "..");
}

export function fixturesDir(): string {
  return path.join(packageRoot(), "fixtures");
}

export function policiesDir(): string {
  return path.join(fixturesDir(), "policies");
}

export function securityFixturesDir(): string {
  return path.join(fixturesDir(), "security");
}

export function releaseNotesFixturePath(): string {
  return path.join(fixturesDir(), "release-notes", "sample-release-notes.md");
}

export function sampleAdvisoriesPath(): string {
  return path.join(securityFixturesDir(), "sample-advisories.json");
}

/** Best-effort monorepo root (workspace). */
export function defaultWorkspaceRoot(): string {
  return path.resolve(packageRoot(), "..", "..");
}
