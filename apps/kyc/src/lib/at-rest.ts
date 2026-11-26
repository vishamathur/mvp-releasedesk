import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** On-disk magic. Payload is AES-256-GCM, never plaintext JSON. */
export const STORE_MAGIC = "KYCENC1";

const AAD = Buffer.from(STORE_MAGIC);
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;

export class StoreConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreConfigError";
  }
}

export class StoreDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreDataError";
  }
}

/**
 * Decode KYC_DATA_KEY. Accepts 64 hex characters or standard base64 of 32 bytes.
 * There is no built-in demo key. A missing or short key fails closed.
 */
export function decodeDataKey(raw: string | undefined): Buffer {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    throw new StoreConfigError(
      "KYC_DATA_KEY is required (32-byte AES-256-GCM key as 64 hex characters or standard base64). Refusing to read or write the KYC store in plaintext.",
    );
  }
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (key.length !== KEY_BYTES) {
    throw new StoreConfigError("KYC_DATA_KEY must decode to exactly 32 bytes.");
  }
  return key;
}

export function loadDataKey(): Buffer {
  return decodeDataKey(process.env.KYC_DATA_KEY);
}

export function encryptUtf8(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [STORE_MAGIC, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(
    ".",
  );
}

export function decryptUtf8(payload: string, key: Buffer): string {
  const trimmed = payload.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    throw new StoreDataError(
      "Refusing to read plaintext store.json. The file was not modified. Set KYC_DATA_KEY and re-seed into a new encrypted store.",
    );
  }
  const parts = trimmed.split(".");
  if (parts.length !== 4 || parts[0] !== STORE_MAGIC) {
    throw new StoreDataError(
      "KYC store is not an AES-256-GCM KYCENC1 payload. Refusing to parse it as plaintext.",
    );
  }
  const ivB64 = parts[1] ?? "";
  const tagB64 = parts[2] ?? "";
  const bodyB64 = parts[3] ?? "";
  try {
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const body = Buffer.from(bodyB64, "base64");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new Error("invalid iv or tag length");
    }
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]);
    return plain.toString("utf8");
  } catch (err) {
    if (err instanceof StoreDataError) throw err;
    throw new StoreDataError(
      "KYC store failed AES-256-GCM authentication. The file was not overwritten.",
    );
  }
}
