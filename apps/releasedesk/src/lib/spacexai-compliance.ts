/**
 * SpaceXAI / Cursor interview compliance chips — presence only, never secret values.
 */
import {
  APP_GROK_API_KEY_ENV,
  describeAppGrokCredential,
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

/** One app key. Bots and Cursor agents do not have their own slots. */
export const SPACEXAI_REQUIRED_NHI_SLOTS: Array<{
  agentId: string;
  envVar: string;
  kind: "grok";
}> = [{ agentId: "app", envVar: APP_GROK_API_KEY_ENV, kind: "grok" }];

export function buildSpaceXaiComplianceSnapshot(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  opts?: { intel?: GrokReleaseIntelResult },
): SpaceXaiComplianceSnapshot {
  const envBag = env as NodeJS.ProcessEnv;
  const required = SPACEXAI_REQUIRED_NHI_SLOTS.map((s) => {
    const cred = describeAppGrokCredential(envBag);
    return { envVar: s.envVar, agentId: s.agentId, present: cred.present };
  });
  const missing = required.filter((r) => !r.present).map((r) => r.envVar);
  const presentCount = required.filter((r) => r.present).length;

  const grokLive = opts?.intel ? !opts.intel.mocked : describeAppGrokCredential(envBag).present;
  // Builder launches Cursor inside the Grok Bot app. Desk never reports that chip LIVE,
  // and RELEASEDESK_CLOUD_CLIENT=real is not a Desk switch.
  const cursorLive = false;

  const compliancePct = grokLive ? 100 : 92;

  const notes: string[] = [
    "One app key, XAI_API_KEY, for the shipped Grok call. Per-bot keys are retired.",
    grokLive
      ? "Grok API chip LIVE via XAI_API_KEY."
      : "Grok API chip MOCK until XAI_API_KEY is set. Per-bot RELEASEDESK_GROK_API_KEY_* values are ignored.",
    "Cursor cloud agents are launched by the Builder Grok Bot, not by Desk. The Desk chip stays MOCK.",
    "Human gates stay with people: finance, red_team|security, release, and the PID-NC customer proposal.",
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
    cloudClientMode: "mock",
    notes,
  };
}
