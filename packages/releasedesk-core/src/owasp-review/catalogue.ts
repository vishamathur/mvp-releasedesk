/**
 * OWASP review catalogue. Exactly these 26 ids are the checklist.
 * LLM ids use the OWASP Top 10 for LLM Applications v1.1 (2023) names.
 * The separate 2025 list in ai-security-frameworks.ts is the merge-block catalogue.
 */

export const OWASP_CONTROL_IDS = [
  "A01",
  "A02",
  "A03",
  "A04",
  "A05",
  "A06",
  "A07",
  "A08",
  "A09",
  "A10",
  "X01",
  "X02",
  "X03",
  "X04",
  "X05",
  "X06",
  "LLM01",
  "LLM02",
  "LLM03",
  "LLM04",
  "LLM05",
  "LLM06",
  "LLM07",
  "LLM08",
  "LLM09",
  "LLM10",
] as const;

export type OwaspControlId = (typeof OWASP_CONTROL_IDS)[number];

export type OwaspControlGroup = "owasp-top-10-2021" | "asvs-api" | "owasp-llm-2023";

export type OwaspControl = {
  id: OwaspControlId;
  name: string;
  group: OwaspControlGroup;
  /** Extra scope note. The id and name are the catalogue contract. */
  note?: string;
};

export const OWASP_CONTROLS: readonly OwaspControl[] = [
  { id: "A01", name: "Broken Access Control", group: "owasp-top-10-2021" },
  { id: "A02", name: "Cryptographic Failures", group: "owasp-top-10-2021" },
  { id: "A03", name: "Injection", group: "owasp-top-10-2021", note: "includes XSS" },
  { id: "A04", name: "Insecure Design", group: "owasp-top-10-2021" },
  { id: "A05", name: "Security Misconfiguration", group: "owasp-top-10-2021", note: "includes XXE" },
  { id: "A06", name: "Vulnerable and Outdated Components", group: "owasp-top-10-2021" },
  { id: "A07", name: "Identification and Authentication Failures", group: "owasp-top-10-2021" },
  { id: "A08", name: "Software and Data Integrity Failures", group: "owasp-top-10-2021", note: "includes insecure deserialization" },
  { id: "A09", name: "Security Logging and Monitoring Failures", group: "owasp-top-10-2021" },
  { id: "A10", name: "Server-Side Request Forgery (SSRF)", group: "owasp-top-10-2021" },
  { id: "X01", name: "Hard-coded secrets and credentials", group: "asvs-api", note: "ASVS V2/V6, CWE-798" },
  { id: "X02", name: "Input validation", group: "asvs-api", note: "ASVS V5" },
  { id: "X03", name: "Session management", group: "asvs-api", note: "ASVS V3" },
  { id: "X04", name: "Error handling and information leakage", group: "asvs-api", note: "ASVS V7" },
  { id: "X05", name: "File handling and path traversal", group: "asvs-api", note: "ASVS V12" },
  { id: "X06", name: "API object-level authorization and mass assignment", group: "asvs-api", note: "OWASP API Top 10 2023 API1/API3" },
  { id: "LLM01", name: "Prompt Injection", group: "owasp-llm-2023" },
  { id: "LLM02", name: "Insecure Output Handling", group: "owasp-llm-2023" },
  { id: "LLM03", name: "Training Data Poisoning", group: "owasp-llm-2023" },
  { id: "LLM04", name: "Model Denial of Service", group: "owasp-llm-2023" },
  { id: "LLM05", name: "Supply Chain Vulnerabilities", group: "owasp-llm-2023" },
  { id: "LLM06", name: "Sensitive Information Disclosure", group: "owasp-llm-2023" },
  { id: "LLM07", name: "Insecure Plugin Design", group: "owasp-llm-2023" },
  { id: "LLM08", name: "Excessive Agency", group: "owasp-llm-2023" },
  { id: "LLM09", name: "Overreliance", group: "owasp-llm-2023" },
  { id: "LLM10", name: "Model Theft", group: "owasp-llm-2023" },
];

const CONTROL_BY_ID = new Map<OwaspControlId, OwaspControl>(OWASP_CONTROLS.map((control) => [control.id, control]));

export function isOwaspControlId(value: string): value is OwaspControlId {
  return CONTROL_BY_ID.has(value as OwaspControlId);
}

export function owaspControl(id: OwaspControlId): OwaspControl {
  const control = CONTROL_BY_ID.get(id);
  if (!control) throw new Error(`unknown OWASP control ${id}`);
  return control;
}

/** Design-level controls whose FAIL defaults to a human when the model omits autoFixable. */
export const DESIGN_LEVEL_CONTROL_IDS: readonly OwaspControlId[] = ["A04", "LLM09"];
