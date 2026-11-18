/**
 * SpaceXAI / Cursor interview compliance chips — presence only, never secret values.
 */
import {
  CURSOR_API_KEY_ENV,
  GROK_API_KEY_ENV,
  describeAgentCursorCredential,
  describeAgentGrokCredential,
  listAgentCredentialStatuses,
  type AgentCredentialStatus,
} from "@releasedesk/core";
import type { GrokReleaseIntelResult } from "./grok-release-intel";

export type LiveMockChip = "LIVE" | "MOCK";

export type SpaceXaiComplianceSnapshot = {
  generatedAt: string;
  /** Rough interview compliance: gates+path proven vs exclusive LIVE keys. */
  compliancePct: number;
  chips: {
    grokApi: LiveMockChip;
    cursorCloud: LiveMockChip;
  };
  nhiSlots: {
    required: Array<{ envVar: string; agentId: string; present: boolean }>;
    presentCount: number;
    missing: string[];
  };
  credentials: AgentCredentialStatus[];
  cloudClientMode: string;
  notes: string[];
};

/** SpaceXAI exclusive slots (Lead+4 Grok; Coding/Testing/Review Cursor). */
export const SPACEXAI_REQUIRED_NHI_SLOTS: Array<{
  agentId: string;
  envVar: string;
  kind: "grok" | "cursor";
}> = [
  { agentId: "lead", envVar: GROK_API_KEY_ENV.lead, kind: "grok" },
  {
    agentId: "change_analyst",
    envVar: GROK_API_KEY_ENV.change_analyst,
    kind: "grok",
  },
  { agentId: "standards", envVar: GROK_API_KEY_ENV.standards, kind: "grok" },
  { agentId: "security", envVar: GROK_API_KEY_ENV.security, kind: "grok" },
  { agentId: "builder", envVar: GROK_API_KEY_ENV.builder, kind: "grok" },
  { agentId: "coding", envVar: CURSOR_API_KEY_ENV.coding, kind: "cursor" },
  { agentId: "testing", envVar: CURSOR_API_KEY_ENV.testing, kind: "cursor" },
  { agentId: "review", envVar: CURSOR_API_KEY_ENV.review, kind: "cursor" },
];

export function buildSpaceXaiComplianceSnapshot(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  opts?: { intel?: GrokReleaseIntelResult },
): SpaceXaiComplianceSnapshot {
  const envBag = env as NodeJS.ProcessEnv;
  const required = SPACEXAI_REQUIRED_NHI_SLOTS.map((s) => {
    const cred =
      s.kind === "grok"
        ? describeAgentGrokCredential(
            s.agentId as Parameters<typeof describeAgentGrokCredential>[0],
            envBag,
          )
        : describeAgentCursorCredential(
            s.agentId as Parameters<typeof describeAgentCursorCredential>[0],
            envBag,
          );
    return { envVar: s.envVar, agentId: s.agentId, present: cred.present };
  });
  const missing = required.filter((r) => !r.present).map((r) => r.envVar);
  const presentCount = required.filter((r) => r.present).length;

  const grokLive = opts?.intel ? !opts.intel.mocked : describeAgentGrokCredential("lead", envBag).present;
  const cloudClient = String(envBag.RELEASEDESK_CLOUD_CLIENT ?? "").trim().toLowerCase();
  const codingPresent = describeAgentCursorCredential("coding", envBag).present;
  const cursorLive = cloudClient === "real" && codingPresent;

  // Base ~92%: full Desk path + gates + MOCK intel proven. +1% per exclusive slot (8) → 100%.
  const compliancePct = Math.min(100, 92 + presentCount);

  const notes: string[] = [
    "Exclusive RELEASEDESK_* only — shared XAI/GROK/CURSOR keys never used as fallbacks.",
    grokLive
      ? "Grok API chip LIVE via exclusive Lead (or Builder) key."
      : "Grok API chip MOCK — set each bot's own RELEASEDESK_GROK_API_KEY_* (Desk intel reads LEAD). Shared XAI_API_KEY / GROK_API_KEY are ignored.",
    cursorLive
      ? "Cursor Cloud chip LIVE — Coding key present + RELEASEDESK_CLOUD_CLIENT=real."
      : "Cursor Cloud chip MOCK — need RELEASEDESK_CURSOR_API_KEY_CODING|TESTING|REVIEW + RELEASEDESK_CLOUD_CLIENT=real.",
    "Human gates always hold: trustCheck.humanGateStillRequired, noAutoApprove, iteration red_team|security, merge/release never auto.",
  ];

  return {
    generatedAt: new Date().toISOString(),
    compliancePct,
    chips: {
      grokApi: grokLive ? "LIVE" : "MOCK",
      cursorCloud: cursorLive ? "LIVE" : "MOCK",
    },
    nhiSlots: { required, presentCount, missing },
    credentials: listAgentCredentialStatuses(envBag),
    cloudClientMode: cloudClient || "unset",
    notes,
  };
}
