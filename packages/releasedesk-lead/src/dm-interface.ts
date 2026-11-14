import { formatMockNote } from "@releasedesk/core";

/**
 * Delivery Manager interface surface for the Lead Agent.
 * Text is the primary channel; voice is stubbed and labeled MOCK until wired.
 */

export type DmChannel = "text" | "voice";

export type DmMessage = {
  channel: DmChannel;
  role: "dm" | "lead";
  text: string;
  at: string;
  mock?: boolean;
};

export type DmSession = {
  messages: DmMessage[];
};

export function createDmSession(): DmSession {
  return { messages: [] };
}

export function receiveDmText(session: DmSession, text: string, at = new Date().toISOString()): DmSession {
  return {
    messages: [
      ...session.messages,
      { channel: "text", role: "dm", text, at },
    ],
  };
}

export function replyAsLead(
  session: DmSession,
  text: string,
  opts?: { channel?: DmChannel; at?: string },
): DmSession {
  const channel = opts?.channel ?? "text";
  const mock = channel === "voice";
  return {
    messages: [
      ...session.messages,
      {
        channel,
        role: "lead",
        text: mock ? formatMockNote(text) : text,
        at: opts?.at ?? new Date().toISOString(),
        ...(mock ? { mock: true } : {}),
      },
    ],
  };
}

/** Voice path is not implemented — always returns a MOCK-labeled acknowledgment. */
export function receiveDmVoiceStub(
  session: DmSession,
  transcript: string,
  at = new Date().toISOString(),
): DmSession {
  const withInbound = {
    messages: [
      ...session.messages,
      {
        channel: "voice" as const,
        role: "dm" as const,
        text: formatMockNote(`Voice transcript: ${transcript}`),
        at,
        mock: true,
      },
    ],
  };
  return replyAsLead(
    withInbound,
    "Voice channel is MOCK-only in Milestone 3; please continue in text.",
    { channel: "voice", at },
  );
}
