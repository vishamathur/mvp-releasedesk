import { z } from "zod";

/**
 * `MOCK:` prefix for the KYC demo notes.
 * A missing Desk credential throws. This helper does not replace that call.
 */
export const MOCK_NOTE_PREFIX = "MOCK:" as const;

export const MockMetaSchema = z.object({
  mocked: z.literal(true),
  mockLabel: z.string().min(1),
  /** Optional free-text already prefixed with MOCK: when present. */
  note: z.string().optional(),
});

export type MockMeta = z.infer<typeof MockMetaSchema>;

export function isMockNote(text: string): boolean {
  return text.trimStart().startsWith(MOCK_NOTE_PREFIX);
}

export function formatMockNote(message: string): string {
  const trimmed = message.trim();
  if (trimmed.startsWith(MOCK_NOTE_PREFIX)) {
    return trimmed;
  }
  return `${MOCK_NOTE_PREFIX} ${trimmed}`;
}

export function createMockMeta(mockLabel: string, note?: string): MockMeta {
  return {
    mocked: true,
    mockLabel,
    ...(note !== undefined ? { note: formatMockNote(note) } : {}),
  };
}
