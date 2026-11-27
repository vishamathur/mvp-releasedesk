import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { policiesDir } from "./paths.js";

export type PolicyDocument = {
  id: string;
  title: string;
  filePath: string;
  body: string;
  requirements: string[];
};

const POLICY_ID_RE = /Policy ID:\s*`?([a-z0-9][a-z0-9\-_/]*)`?/i;

function extractRequirements(body: string): string[] {
  const lines = body.split("\n");
  const reqs: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\d+\.\s+\*\*([^*]+)\*\*\s+[—–-]\s+(.+)$/);
    if (m) {
      reqs.push(`${m[1]!.trim()}: ${m[2]!.trim()}`);
      continue;
    }
    const m2 = line.match(/^\d+\.\s+(.+)$/);
    if (m2) reqs.push(m2[1]!.trim());
  }
  return reqs;
}

function extractPolicyId(body: string, fallbackFile: string): string {
  const m = body.match(POLICY_ID_RE);
  if (m?.[1]) return m[1];
  return path.basename(fallbackFile, path.extname(fallbackFile));
}

function extractTitle(body: string, fallback: string): string {
  const line = body.split("\n").find((l) => l.startsWith("# "));
  return line ? line.replace(/^#\s+/, "").trim() : fallback;
}

export async function loadPolicyCorpus(dir = policiesDir()): Promise<PolicyDocument[]> {
  const entries = await readdir(dir);
  const docs: PolicyDocument[] = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const filePath = path.join(dir, name);
    const body = await readFile(filePath, "utf8");
    const id = extractPolicyId(body, name);
    docs.push({
      id,
      title: extractTitle(body, name),
      filePath,
      body,
      requirements: extractRequirements(body),
    });
  }
  return docs.sort((a, b) => a.id.localeCompare(b.id));
}

export function selectPolicies(
  corpus: PolicyDocument[],
  policyRefs: string[],
): PolicyDocument[] {
  if (policyRefs.length === 0) return corpus;
  const wanted = new Set(policyRefs.map((p) => p.toLowerCase()));
  const matched = corpus.filter(
    (p) =>
      wanted.has(p.id.toLowerCase()) ||
      [...wanted].some((w) => p.id.toLowerCase().includes(w) || w.includes(p.id.toLowerCase())),
  );
  return matched.length > 0 ? matched : corpus;
}


export function isWebsiteCreationContext(opts: {
  changeSummary?: string;
  requestType?: string;
  catalogueOptionId?: string;
}): boolean {
  if (opts.requestType === "website-creation") return true;
  const option = (opts.catalogueOptionId ?? "").toUpperCase();
  if (option === "NC-WEBSITE" || option === "SX-LANDING-PAGE") return true;
  const text = (opts.changeSummary ?? "").toLowerCase();
  return (
    text.includes("website-creation") ||
    text.includes("inspiration style") ||
    text.includes("nc-website") ||
    text.includes("sx-landing-page")
  );
}

/** Default and request-aware policy refs for the Standards runner. */
export function resolveStandardsPolicyRefs(opts: {
  policyRefs?: string[];
  changeSummary?: string;
  requestType?: string;
  catalogueOptionId?: string;
}): string[] {
  const website = isWebsiteCreationContext(opts);
  const incoming = (opts.policyRefs ?? []).map((r) => r.trim()).filter(Boolean);
  if (incoming.length > 0) {
    const refs = [...incoming];
    const hasWebsite = refs.some((r) => r.toLowerCase().includes("website-creation"));
    if (website && !hasWebsite) refs.push("website-creation-template");
    return refs;
  }
  // Website requests from any customer load the industry-neutral template.
  // Do not default those requests onto Northwind KYC policy.
  if (website) return ["website-creation-template"];
  return ["northwind-kyc-baseline"];
}

/**
 * Evaluate loaded policies against change text / repo signals.
 * Returns evidence-backed deviations (heuristic; Grok may enrich later).
 */
export function evaluatePolicyDeviations(opts: {
  policies: PolicyDocument[];
  changeSummary?: string;
  changedPaths?: string[];
  repoSignals?: {
    hasMockScreeningLabel?: boolean;
    hasRiskScoring?: boolean;
    hasAnalystActions?: boolean;
    hasHumanApprovalGates?: boolean;
    secretsInDiff?: boolean;
  };
}): Array<{
  policyRef: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  summary: string;
  recommendation?: string;
}> {
  const deviations: Array<{
    policyRef: string;
    severity: "info" | "low" | "medium" | "high" | "critical";
    summary: string;
    recommendation?: string;
  }> = [];

  const text = `${opts.changeSummary ?? ""}\n${(opts.changedPaths ?? []).join("\n")}`.toLowerCase();
  const signals = opts.repoSignals ?? {};

  for (const policy of opts.policies) {
    if (policy.id === "northwind-kyc-baseline") {
      if (signals.hasRiskScoring === true && signals.hasMockScreeningLabel === false) {
        deviations.push({
          policyRef: policy.id,
          severity: "high",
          summary:
            "Risk / screening path present without MOCK: labeling evidence for fabricated vendor results.",
          recommendation: "Ensure screening notes use the MOCK: prefix when vendor APIs are stubbed.",
        });
      }
      if (signals.hasAnalystActions === false) {
        deviations.push({
          policyRef: policy.id,
          severity: "medium",
          summary: "Analyst approve/reject/needs-info controls not detected in evaluated signals.",
          recommendation: "Confirm analyst actions remain available before release.",
        });
      }
      if (text.includes("auto-approve") && text.includes("kyc")) {
        deviations.push({
          policyRef: policy.id,
          severity: "critical",
          summary: "Change text references KYC auto-approval, which this policy prohibits.",
          recommendation: "Remove silent KYC auto-approval paths.",
        });
      }
    }

    if (policy.id === "northwind-data-retention") {
      if (signals.secretsInDiff === true) {
        deviations.push({
          policyRef: policy.id,
          severity: "critical",
          summary: "Diff signals suggest secrets or credential material may be present.",
          recommendation: "Remove secrets from source control and rotate credentials.",
        });
      }
      if (text.includes("government id") && text.includes("console.log")) {
        deviations.push({
          policyRef: policy.id,
          severity: "high",
          summary: "Possible logging of government ID material referenced in change summary.",
          recommendation: "Redact PII from application logs.",
        });
      }
    }

    if (policy.id === "northwind-auth-standards") {
      if (signals.hasHumanApprovalGates === false) {
        deviations.push({
          policyRef: policy.id,
          severity: "high",
          summary: "Human merge/release approval gates not detected for regulated release flow.",
          recommendation: "Keep Lead human approval gates pending until a human decides.",
        });
      }
    }

    if (policy.id === "website-creation-template") {
      const mentionsInspiration =
        text.includes("inspiration") || text.includes("style summary") || text.includes("style cue");
      const mentionsPalette = text.includes("palette") || text.includes("colour") || text.includes("color");
      const waivesContrast =
        (text.includes("wcag") || text.includes("contrast")) &&
        (text.includes("waive") || text.includes("skip contrast") || text.includes("ignore contrast"));

      if (
        mentionsInspiration &&
        (text.includes("reproduce the logo") ||
          text.includes("copy the logo") ||
          text.includes("reuse the logo") ||
          text.includes("reproduce the wordmark") ||
          text.includes("use the photo as a hero") ||
          text.includes("use the photograph as a hero") ||
          text.includes("paste the photo onto the site"))
      ) {
        deviations.push({
          policyRef: `${policy.id}/6`,
          severity: "high",
          summary:
            "Change text proposes reproducing logos, wordmarks or photographic imagery from an inspiration photograph.",
          recommendation:
            "Use only abstract style attributes from the style summary, and only assets the customer has the right to provide.",
        });
      }

      if (waivesContrast && mentionsPalette) {
        deviations.push({
          policyRef: `${policy.id}/2`,
          severity: "high",
          summary: "Change text waives WCAG 2.2 AA contrast in order to keep a suggested palette colour.",
          recommendation:
            "Adjust the palette so text and essential UI meet WCAG 2.2 Level AA, and record the adjustment.",
        });
      }

      if (
        mentionsInspiration &&
        (text.includes("style takes precedence over brand") ||
          text.includes("style takes precedence over regulat") ||
          text.includes("override brand") ||
          text.includes("override regulatory") ||
          text.includes("override legal") ||
          text.includes("ignore brand guidelines") ||
          text.includes("ignore regulatory") ||
          text.includes("ignore legal"))
      ) {
        deviations.push({
          policyRef: `${policy.id}/3`,
          severity: "high",
          summary:
            "Change text lets inspiration style take precedence over brand or the industry's regulatory or legal requirements.",
          recommendation:
            "Follow the customer's brand and their industry's regulatory and legal requirements, and record any style cue that was adjusted.",
        });
      }

      if (
        mentionsInspiration &&
        (text.includes("send the photo to the builder") ||
          text.includes("send the photograph to the builder") ||
          text.includes("attach the inspiration photo") ||
          text.includes("use the raw photo") ||
          text.includes("use the raw photograph") ||
          text.includes("pass the photograph through"))
      ) {
        deviations.push({
          policyRef: `${policy.id}/5`,
          severity: "high",
          summary:
            "Change text uses the inspiration photograph as a build input instead of the extracted style summary.",
          recommendation:
            "Carry only the style summary (palette hex codes, mood, textures, typography feel and layout cues) in the brief.",
        });
      }

      if (
        mentionsInspiration &&
        (text.includes("required style") || text.includes("required palette") || text.includes("required typography")) &&
        (text.includes("drop") || text.includes("ignore") || text.includes("skip")) &&
        !text.includes("record") &&
        !text.includes("reason")
      ) {
        deviations.push({
          policyRef: `${policy.id}/4`,
          severity: "medium",
          summary: "A required style cue appears to have been dropped without recording why.",
          recommendation: "Record what was changed and why in the pull request or design notes.",
        });
      }

      if (
        (text.includes("website-creation") || text.includes("inspiration style")) &&
        (text.includes("skip visual review") || text.includes("no visual review") || text.includes("without a visual review"))
      ) {
        deviations.push({
          policyRef: `${policy.id}/7`,
          severity: "medium",
          summary:
            "A website-creation change with an inspiration style summary omits the required visual review against that summary.",
          recommendation:
            "Include a visual review in the pull request: what was applied, what was adjusted, and why.",
        });
      }
    }
  }

  return deviations;
}
