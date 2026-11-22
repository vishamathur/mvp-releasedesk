import { readFile } from "node:fs/promises";

export type SampleAdvisory = {
  id: string;
  advisoryId: string;
  title: string;
  summary: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  packageName: string;
  ecosystem: string;
  vulnerableVersions: string;
  fixedVersion: string | null;
  releaseBlocking: boolean;
  references: string[];
};

export type AdvisoryCorpus = {
  source: string;
  note?: string;
  advisories: SampleAdvisory[];
};

export type ComponentRef = {
  name: string;
  version?: string;
  ecosystem?: string;
};

export async function loadAdvisoryCorpus(filePath: string): Promise<AdvisoryCorpus> {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as AdvisoryCorpus;
  if (!Array.isArray(parsed.advisories)) {
    throw new Error(`Invalid advisory corpus at ${filePath}`);
  }
  return parsed;
}

/** Very small semver-ish check for fixture ranges like `<9.9.9`, `<=1.2.3`, `*`. */
export function versionMatchesRange(version: string | undefined, range: string): boolean {
  if (!range || range === "*") return true;
  if (!version) {
    // Unknown version — correlate by package name only for fixture matching.
    return true;
  }
  const v = normalizeVersion(version);
  const le = range.match(/^<=\s*(.+)$/);
  if (le) return cmpSemver(v, normalizeVersion(le[1]!)) <= 0;
  const lt = range.match(/^<\s*(.+)$/);
  if (lt) return cmpSemver(v, normalizeVersion(lt[1]!)) < 0;
  const ge = range.match(/^>=\s*(.+)$/);
  if (ge) return cmpSemver(v, normalizeVersion(ge[1]!)) >= 0;
  const eq = range.match(/^=?\s*(.+)$/);
  if (eq) return cmpSemver(v, normalizeVersion(eq[1]!)) === 0;
  return true;
}

function normalizeVersion(v: string): [number, number, number] {
  const cleaned = v.replace(/^v/, "").split("-")[0] ?? "0.0.0";
  const parts = cleaned.split(".").map((p) => Number.parseInt(p.replace(/[^\d]/g, ""), 10) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function cmpSemver(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  }
  return 0;
}

export function correlateAdvisories(
  advisories: SampleAdvisory[],
  components: ComponentRef[],
  advisoryHints: string[] = [],
): Array<SampleAdvisory & { matchedComponent: ComponentRef }> {
  const byName = new Map(components.map((c) => [c.name.toLowerCase(), c]));
  const hints = new Set(advisoryHints.map((h) => h.toLowerCase()));
  const out: Array<SampleAdvisory & { matchedComponent: ComponentRef }> = [];

  for (const adv of advisories) {
    const hintHit =
      hints.has(adv.id.toLowerCase()) ||
      hints.has(adv.advisoryId.toLowerCase()) ||
      hints.has(adv.packageName.toLowerCase());
    const comp = byName.get(adv.packageName.toLowerCase());
    if (!comp && !hintHit) continue;
    const matched = comp ?? { name: adv.packageName, ecosystem: adv.ecosystem };
    if (comp && !versionMatchesRange(comp.version, adv.vulnerableVersions) && !hintHit) {
      continue;
    }
    out.push({ ...adv, matchedComponent: matched });
  }
  return out;
}

export function riskLevelFromFindings(
  findings: Array<{ severity: string; releaseBlocking: boolean }>,
): "none" | "low" | "medium" | "high" | "critical" {
  if (findings.some((f) => f.releaseBlocking || f.severity === "critical")) return "critical";
  if (findings.some((f) => f.severity === "high")) return "high";
  if (findings.some((f) => f.severity === "medium")) return "medium";
  if (findings.some((f) => f.severity === "low" || f.severity === "info")) return "low";
  return "none";
}
