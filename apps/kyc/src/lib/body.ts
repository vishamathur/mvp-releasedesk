export const MAX_JSON_BODY_BYTES = 16 * 1024;

export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large.");
    this.name = "BodyTooLargeError";
  }
}

export function assertDeclaredBodyLimit(request: Request): void {
  const declared = request.headers.get("content-length");
  if (declared === null) return;
  const size = Number(declared);
  if (!Number.isFinite(size) || size > MAX_JSON_BODY_BYTES) {
    throw new BodyTooLargeError();
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  assertDeclaredBodyLimit(request);
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_JSON_BODY_BYTES) {
    throw new BodyTooLargeError();
  }
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SyntaxError("Invalid JSON body");
  }
}
