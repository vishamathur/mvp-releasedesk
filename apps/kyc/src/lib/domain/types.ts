/** Core KYC domain types for Northwind Bank. */

export type ApplicationStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "approved"
  | "rejected"
  | "needs_info";

export type RiskLevel = "low" | "medium" | "high";

export type DocumentType =
  | "passport"
  | "national_id"
  | "drivers_license"
  | "proof_of_address"
  | "selfie";

export type DocumentStatus = "placeholder" | "uploaded" | "verified" | "rejected";

export interface Identity {
  firstName: string;
  lastName: string;
  dateOfBirth: string; // ISO date YYYY-MM-DD
  nationality: string; // ISO 3166-1 alpha-2
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  postalCode: string;
  country: string; // ISO 3166-1 alpha-2
  /**
   * Optional job title. Ordinary personal data, not a special-category attribute.
   * Omitted on records captured before the field existed.
   */
  occupation?: string;
}

export interface KycDocument {
  id: string;
  type: DocumentType;
  fileName: string;
  /** MOCK: no real file bytes are stored; this is a demo placeholder. */
  mockStorageKey: string;
  status: DocumentStatus;
  uploadedAt: string;
  /** MOCK: OCR / extraction results are fabricated locally. */
  mockOcrSummary?: string;
}

export interface RiskAssessment {
  level: RiskLevel;
  score: number;
  factors: string[];
  assessedAt: string;
  /** MOCK: no external risk / sanctions screening API is called. */
  mockScreeningNote: string;
}

export interface KycApplication {
  id: string;
  reference: string;
  status: ApplicationStatus;
  identity: Identity | null;
  documents: KycDocument[];
  risk: RiskAssessment | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  notes: string[];
  /** Customer actor id that created the case. Null for synthetic seed samples. */
  createdBy: string | null;
  /** Analyst actor id for the latest review decision. Never taken from the client. */
  decidedBy: string | null;
}

export interface CreateApplicationInput {
  /** Parsed with the Identity allow-list. Extra keys are rejected. */
  identity: unknown;
}

export interface AddDocumentInput {
  type: DocumentType;
  fileName: string;
}

export const ALLOWED_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  draft: ["submitted"],
  submitted: ["in_review", "needs_info"],
  in_review: ["approved", "rejected", "needs_info"],
  needs_info: ["submitted"],
  approved: [],
  rejected: [],
};
