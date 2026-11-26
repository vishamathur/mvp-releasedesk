import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { decryptUtf8, encryptUtf8, loadDataKey, StoreConfigError, StoreDataError } from "./at-rest";
import { sanitizeStoredIdentity } from "./domain/validation";
import type {
  ApplicationStatus,
  DocumentStatus,
  DocumentType,
  KycApplication,
  KycDocument,
  RiskAssessment,
  RiskLevel,
} from "./domain/types";

/**
 * northwind-data-retention R-1.
 * Abandoned drafts and rejected applications are eligible 90 days after `updatedAt`.
 * Approved records follow KYC_APPROVED_RETENTION_DAYS (default 5 years), a demo
 * assumption pending compliance confirmation. In-flight cases are not auto-purged.
 */
export const PII_RETENTION_DAYS = 90;
export const PII_RETENTION_MS = PII_RETENTION_DAYS * 24 * 60 * 60 * 1000;
/** 5 * 365 days. Demo assumption, not a confirmed regulatory period. */
export const DEFAULT_APPROVED_RETENTION_DAYS = 5 * 365;
export const PII_RETENTION_POLICY = "northwind-data-retention";

export type RetentionAction = "delete" | "purge" | "seed-replace" | "delete-approved-override";

export type DeleteResult =
  | { deleted: true }
  | { deleted: false; reason: "missing" | "approved" };

export interface RetentionEvent {
  at: string;
  actorId: string;
  applicationIds: string[];
  action: RetentionAction;
}

export interface StoreData {
  applications: KycApplication[];
  seededAt: string | null;
  retentionLog: RetentionEvent[];
}

const STORE_FILE = "store.json";
const RETENTION_LOG_CAP = 50;
const STATUSES = new Set<ApplicationStatus>([
  "draft",
  "submitted",
  "in_review",
  "approved",
  "rejected",
  "needs_info",
]);

const DOCUMENT_TYPES = new Set<DocumentType>([
  "passport",
  "national_id",
  "drivers_license",
  "proof_of_address",
  "selfie",
]);

const DOCUMENT_STATUSES = new Set<DocumentStatus>(["placeholder", "uploaded", "verified", "rejected"]);
const RISK_LEVELS = new Set<RiskLevel>(["low", "medium", "high"]);

const emptyStore = (): StoreData => ({
  applications: [],
  seededAt: null,
  retentionLog: [],
});

function dataDir(): string {
  return process.env.KYC_DATA_DIR
    ? path.resolve(process.env.KYC_DATA_DIR)
    : path.join(process.cwd(), "data");
}

function storePath(): string {
  return path.join(dataDir(), STORE_FILE);
}

let chain: Promise<void> = Promise.resolve();

export function assertLocalStoreAllowed(): void {
  if (process.env.NODE_ENV === "production" && process.env.KYC_ALLOW_LOCAL_STORE !== "true") {
    throw new StoreConfigError("Local demo store is disabled.");
  }
}

function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    assertLocalStoreAllowed();
    return fn();
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function sanitizeDocument(value: unknown): KycDocument {
  if (!value || typeof value !== "object") {
    throw new StoreDataError("KYC store document is corrupt.");
  }
  const doc = value as Partial<KycDocument>;
  if (
    typeof doc.id !== "string" ||
    typeof doc.type !== "string" ||
    !DOCUMENT_TYPES.has(doc.type as DocumentType) ||
    typeof doc.fileName !== "string"
  ) {
    throw new StoreDataError("KYC store document is corrupt.");
  }
  const status = DOCUMENT_STATUSES.has(doc.status as DocumentStatus)
    ? (doc.status as DocumentStatus)
    : "uploaded";
  const next: KycDocument = {
    id: doc.id,
    type: doc.type as DocumentType,
    fileName: doc.fileName,
    mockStorageKey: asString(doc.mockStorageKey),
    status,
    uploadedAt: asString(doc.uploadedAt),
  };
  if (typeof doc.mockOcrSummary === "string") next.mockOcrSummary = doc.mockOcrSummary;
  return next;
}

function sanitizeRisk(value: unknown): RiskAssessment | null {
  if (value == null) return null;
  if (typeof value !== "object") throw new StoreDataError("KYC store risk block is corrupt.");
  const risk = value as Partial<RiskAssessment>;
  if (
    typeof risk.level !== "string" ||
    !RISK_LEVELS.has(risk.level as RiskLevel) ||
    typeof risk.score !== "number" ||
    !Array.isArray(risk.factors)
  ) {
    throw new StoreDataError("KYC store risk block is corrupt.");
  }
  return {
    level: risk.level as RiskLevel,
    score: risk.score,
    factors: risk.factors.filter((factor): factor is string => typeof factor === "string"),
    assessedAt: asString(risk.assessedAt),
    mockScreeningNote: asString(risk.mockScreeningNote),
  };
}

function sanitizeApplication(value: unknown): KycApplication {
  if (!value || typeof value !== "object") {
    throw new StoreDataError("KYC store application is corrupt.");
  }
  const app = value as Partial<KycApplication> & { identity?: unknown };
  if (typeof app.id !== "string" || typeof app.status !== "string" || !STATUSES.has(app.status as ApplicationStatus)) {
    throw new StoreDataError("KYC store application is corrupt.");
  }
  let identity: KycApplication["identity"] = null;
  if (app.identity != null) {
    identity = sanitizeStoredIdentity(app.identity);
    if (!identity) throw new StoreDataError("KYC store identity is corrupt.");
  }
  if (!Array.isArray(app.documents)) throw new StoreDataError("KYC store documents are corrupt.");
  return {
    id: app.id,
    reference: asString(app.reference),
    status: app.status as ApplicationStatus,
    identity,
    documents: app.documents.map(sanitizeDocument),
    risk: sanitizeRisk(app.risk),
    createdAt: asString(app.createdAt),
    updatedAt: asString(app.updatedAt),
    submittedAt: typeof app.submittedAt === "string" ? app.submittedAt : null,
    notes: Array.isArray(app.notes) ? app.notes.filter((note): note is string => typeof note === "string") : [],
    createdBy: typeof app.createdBy === "string" ? app.createdBy : null,
    applicantCredentialHash:
      typeof app.applicantCredentialHash === "string" && /^[a-f0-9]{64}$/.test(app.applicantCredentialHash)
        ? app.applicantCredentialHash
        : null,
    decidedBy: typeof app.decidedBy === "string" ? app.decidedBy : null,
  };
}

function sanitizeRetention(value: unknown): RetentionEvent[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new StoreDataError("KYC store retention log is corrupt.");
  return value.slice(-RETENTION_LOG_CAP).map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new StoreDataError("KYC store retention log is corrupt.");
    }
    const event = entry as Partial<RetentionEvent>;
    if (typeof event.at !== "string" || typeof event.actorId !== "string" || typeof event.action !== "string") {
      throw new StoreDataError("KYC store retention log is corrupt.");
    }
    if (!Array.isArray(event.applicationIds) || event.applicationIds.some((id) => typeof id !== "string")) {
      throw new StoreDataError("KYC store retention log is corrupt.");
    }
    return {
      at: event.at,
      actorId: event.actorId,
      applicationIds: event.applicationIds,
      action: event.action as RetentionAction,
    };
  });
}

function normalizeStore(value: unknown): StoreData {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StoreDataError("KYC store payload is corrupt.");
  }
  const record = value as Partial<StoreData>;
  if (!Array.isArray(record.applications)) {
    throw new StoreDataError("KYC store payload is corrupt.");
  }
  return {
    applications: record.applications.map(sanitizeApplication),
    seededAt: typeof record.seededAt === "string" ? record.seededAt : null,
    retentionLog: sanitizeRetention(record.retentionLog),
  };
}

async function maybeTestWriteDelay(): Promise<void> {
  if (process.env.NODE_ENV !== "test") return;
  const raw = process.env.KYC_STORE_WRITE_DELAY_MS;
  if (!raw) return;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeStoreUnlocked(data: StoreData): Promise<void> {
  const dir = dataDir();
  await fs.mkdir(dir, { recursive: true });
  const body = encryptUtf8(JSON.stringify(data), loadDataKey());
  const tmp = path.join(dir, `.store.${process.pid}.${randomUUID()}.tmp`);
  try {
    await maybeTestWriteDelay();
    await fs.writeFile(tmp, body, { encoding: "utf8", mode: 0o600 });
    await fs.rename(tmp, storePath());
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

async function readStoreUnlocked(): Promise<StoreData> {
  const target = storePath();
  let raw: string;
  try {
    raw = await fs.readFile(target, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
    const empty = emptyStore();
    await writeStoreUnlocked(empty);
    return empty;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decryptUtf8(raw, loadDataKey())) as unknown;
  } catch (err) {
    if (err instanceof StoreDataError || err instanceof SyntaxError) {
      throw err instanceof StoreDataError
        ? err
        : new StoreDataError("KYC store payload is corrupt. The file was not overwritten.");
    }
    throw err;
  }
  return normalizeStore(parsed);
}

function remember(store: StoreData, event: RetentionEvent): void {
  store.retentionLog = [...store.retentionLog, event].slice(-RETENTION_LOG_CAP);
}

export function approvedRetentionMs(): number {
  const raw = process.env.KYC_APPROVED_RETENTION_DAYS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_APPROVED_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 36500) {
    throw new StoreConfigError("Approved retention period is invalid.");
  }
  return days * 24 * 60 * 60 * 1000;
}

/** Automatic purge window. Null means the case is kept until a decision or the approved period. */
export function retentionWindowMs(app: KycApplication): number | null {
  if (app.status === "approved") return approvedRetentionMs();
  if (app.status === "draft" || app.status === "rejected") return PII_RETENTION_MS;
  return null;
}

export function isPastRetention(app: KycApplication, now = new Date()): boolean {
  const windowMs = retentionWindowMs(app);
  if (windowMs === null) return false;
  const updated = new Date(app.updatedAt).getTime();
  if (Number.isNaN(updated)) return false;
  return now.getTime() - updated >= windowMs;
}

export async function readStore(): Promise<StoreData> {
  return withStoreLock(() => readStoreUnlocked());
}

export async function writeStore(data: StoreData): Promise<void> {
  await withStoreLock(() => writeStoreUnlocked(data));
}

export async function listApplications(): Promise<KycApplication[]> {
  const store = await readStore();
  return [...store.applications].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export async function getApplication(id: string): Promise<KycApplication | null> {
  const store = await readStore();
  return store.applications.find((application) => application.id === id) ?? null;
}

export async function saveApplication(app: KycApplication): Promise<KycApplication> {
  return withStoreLock(async () => {
    const store = await readStoreUnlocked();
    const idx = store.applications.findIndex((application) => application.id === app.id);
    if (idx >= 0) store.applications[idx] = app;
    else store.applications.push(app);
    await writeStoreUnlocked(store);
    return app;
  });
}

export async function deleteApplication(
  id: string,
  actorId: string,
  options?: { approvedOverride?: boolean },
): Promise<DeleteResult> {
  return withStoreLock(async () => {
    const store = await readStoreUnlocked();
    const existing = store.applications.find((application) => application.id === id);
    if (!existing) return { deleted: false, reason: "missing" };
    if (existing.status === "approved" && !options?.approvedOverride) {
      return { deleted: false, reason: "approved" };
    }
    store.applications = store.applications.filter((application) => application.id !== id);
    remember(store, {
      at: new Date().toISOString(),
      actorId,
      applicationIds: [id],
      action: existing.status === "approved" ? "delete-approved-override" : "delete",
    });
    await writeStoreUnlocked(store);
    return { deleted: true };
  });
}

export async function purgeExpiredApplications(actorId: string, now = new Date()): Promise<string[]> {
  return withStoreLock(async () => {
    const store = await readStoreUnlocked();
    const expired = store.applications.filter((application) => isPastRetention(application, now)).map((application) => application.id);
    if (expired.length === 0) return [];
    const drop = new Set(expired);
    store.applications = store.applications.filter((application) => !drop.has(application.id));
    remember(store, {
      at: now.toISOString(),
      actorId,
      applicationIds: expired,
      action: "purge",
    });
    await writeStoreUnlocked(store);
    return expired;
  });
}

export async function replaceAllApplications(
  applications: KycApplication[],
  seededAt: string,
  actorId: string,
): Promise<StoreData> {
  return withStoreLock(async () => {
    const existing = await readStoreUnlocked();
    const previousIds = existing.applications.map((application) => application.id);
    const next: StoreData = {
      applications,
      seededAt,
      retentionLog: existing.retentionLog,
    };
    remember(next, {
      at: seededAt,
      actorId,
      applicationIds: previousIds,
      action: "seed-replace",
    });
    await writeStoreUnlocked(next);
    return next;
  });
}
