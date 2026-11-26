import { assessRisk } from "./risk";
import { canSubmitApplication, parseIdentity } from "./validation";
import { transitionStatus } from "./status";
import type {
  AddDocumentInput,
  CreateApplicationInput,
  DocumentType,
  KycApplication,
  KycDocument,
} from "./types";

function isoNow(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function referenceFromId(id: string): string {
  return `NW-${id.slice(-8).toUpperCase()}`;
}

const ACTOR_RE = /^[A-Za-z0-9:._-]{1,64}$/;

function requireActorId(actorId: string, label: string): string {
  const actor = actorId.trim();
  if (!ACTOR_RE.test(actor)) {
    throw new Error(`${label} actor is required.`);
  }
  return actor;
}

function mockOcrSummary(type: DocumentType, fileName: string): string {
  return `MOCK OCR: Detected ${type.replaceAll("_", " ")} from “${fileName}” — fields not extracted (placeholder).`;
}

export function createDraftApplication(
  input: CreateApplicationInput,
  now?: Date,
  createdBy?: string | null,
): KycApplication {
  const identity = parseIdentity(input.identity);
  const owner = createdBy == null || createdBy === "" ? null : requireActorId(createdBy, "createdBy");

  const createdAt = isoNow(now);
  const id = newId("app");

  return {
    id,
    reference: referenceFromId(id),
    status: "draft",
    identity,
    documents: [],
    risk: null,
    createdAt,
    updatedAt: createdAt,
    submittedAt: null,
    notes: ["Application created"],
    createdBy: owner,
    applicantCredentialHash: null,
    decidedBy: null,
  };
}

export function updateIdentity(
  app: KycApplication,
  identity: unknown,
  now?: Date,
): KycApplication {
  if (app.status !== "draft" && app.status !== "needs_info") {
    throw new Error("Identity can only be edited in draft or needs_info.");
  }
  const nextIdentity = parseIdentity(identity);
  return {
    ...app,
    identity: nextIdentity,
    updatedAt: isoNow(now),
    notes: [...app.notes, "Identity updated"],
  };
}

export function addDocument(
  app: KycApplication,
  input: AddDocumentInput,
  now?: Date,
): KycApplication {
  if (app.status !== "draft" && app.status !== "needs_info") {
    throw new Error("Documents can only be added in draft or needs_info.");
  }
  if (!input.fileName.trim()) {
    throw new Error("fileName is required.");
  }

  const uploadedAt = isoNow(now);
  const doc: KycDocument = {
    id: newId("doc"),
    type: input.type,
    fileName: input.fileName.trim(),
    mockStorageKey: `mock://docs/${app.id}/${input.type}/${encodeURIComponent(input.fileName.trim())}`,
    status: "uploaded",
    uploadedAt,
    mockOcrSummary: mockOcrSummary(input.type, input.fileName.trim()),
  };

  return {
    ...app,
    documents: [...app.documents, doc],
    updatedAt: uploadedAt,
    notes: [...app.notes, `Document placeholder added: ${input.type}`],
  };
}

export function submitApplication(app: KycApplication, now?: Date): KycApplication {
  const issues = canSubmitApplication({
    identity: app.identity,
    documentTypes: app.documents.map((d) => d.type),
  });
  if (issues.length > 0) {
    throw new Error(issues.map((i) => i.message).join("; "));
  }
  if (!app.identity) {
    throw new Error("Identity is required.");
  }

  const submittedAt = isoNow(now);
  const risk = assessRisk({
    identity: app.identity,
    documentCount: app.documents.length,
    hasSelfie: app.documents.some((d) => d.type === "selfie"),
    now: now ?? new Date(submittedAt),
  });

  const nextStatus = transitionStatus(app.status === "needs_info" ? "needs_info" : "draft", "submitted");

  return {
    ...app,
    status: nextStatus,
    risk,
    submittedAt,
    updatedAt: submittedAt,
    notes: [
      ...app.notes,
      `Submitted with ${risk.level} risk (score ${risk.score})`,
      risk.mockScreeningNote,
    ],
  };
}

export function advanceReview(
  app: KycApplication,
  decision: "in_review" | "approved" | "rejected" | "needs_info",
  actorId: string,
  note?: string,
  now?: Date,
): KycApplication {
  const actor = requireActorId(actorId, "decidedBy");
  if (note !== undefined && note.length > 500) {
    throw new Error("note must be at most 500 characters.");
  }
  const next = transitionStatus(app.status, decision);
  const updatedAt = isoNow(now);
  const text = note?.trim() || `Status → ${decision}`;
  return {
    ...app,
    status: next,
    decidedBy: actor,
    updatedAt,
    notes: [...app.notes, `${text} [decidedBy: ${actor}]`],
  };
}
