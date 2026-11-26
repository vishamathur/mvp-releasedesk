/** Relative in-app path only. Rejects protocol-relative, backslash, and scheme URLs. */
export function safeNext(value: string | undefined): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  if (value.startsWith("/\\")) return "/";
  if (value.includes("\\")) return "/";
  if (value.includes("://")) return "/";
  if (value.includes("\0") || value.includes("\r") || value.includes("\n")) return "/";
  return value;
}
