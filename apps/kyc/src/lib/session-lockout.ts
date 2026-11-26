import { createHash } from "node:crypto";

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

interface FailureState {
  count: number;
  lockedUntil: number;
}

const failures = new Map<string, FailureState>();

function locked(entry: FailureState | undefined, now: number): boolean {
  return Boolean(entry && entry.lockedUntil > now);
}

export function sessionClientKeys(request: Request, token: string): string[] {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const fingerprint = createHash("sha256").update(token).digest("hex").slice(0, 16);
  return [`ip:${forwarded}`, `token:${fingerprint}`];
}

export function sessionIsLocked(keys: string[], now = Date.now()): boolean {
  return keys.some((key) => locked(failures.get(key), now));
}

/** Returns true when this failure starts or continues a lockout. */
export function recordSessionFailure(keys: string[], now = Date.now()): boolean {
  let lockedNow = false;
  for (const key of keys) {
    const entry = failures.get(key) ?? { count: 0, lockedUntil: 0 };
    if (entry.lockedUntil > now) {
      lockedNow = true;
      continue;
    }
    if (entry.lockedUntil && entry.lockedUntil <= now) {
      entry.count = 0;
      entry.lockedUntil = 0;
    }
    entry.count += 1;
    if (entry.count >= MAX_FAILURES) {
      entry.lockedUntil = now + LOCK_MS;
      lockedNow = true;
    }
    failures.set(key, entry);
  }
  return lockedNow;
}

export function clearSessionFailures(keys: string[]): void {
  for (const key of keys) failures.delete(key);
}

export function resetSessionLockoutForTests(): void {
  failures.clear();
}
