/**
 * Delivery Manager interface surface for the Lead Agent.
 * Text is the channel. Voice throws.
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
  if (channel === "voice") {
    throw new Error("Voice is not available. Use text.");
  }
  return {
    messages: [
      ...session.messages,
      {
        channel,
        role: "lead",
        text,
        at: opts?.at ?? new Date().toISOString(),
      },
    ],
  };
}

/** Voice is not a Release Desk channel. */
export function receiveDmVoiceStub(_session: DmSession, _transcript: string): DmSession {
  throw new Error("Voice is not available. Use text.");
}
