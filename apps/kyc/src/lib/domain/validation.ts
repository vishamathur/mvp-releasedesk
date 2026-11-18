import type { DocumentType, Identity } from "./types";

export interface ValidationIssue {
  field: string;
  message: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s\-()]{8,20}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

function ageFromDob(dob: string, asOf: Date = new Date()): number | null {
  if (!ISO_DATE_RE.test(dob)) return null;
  const birth = new Date(`${dob}T00:00:00.000Z`);
  if (Number.isNaN(birth.getTime())) return null;
  let age = asOf.getUTCFullYear() - birth.getUTCFullYear();
  const m = asOf.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && asOf.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  return age;
}

export function validateIdentity(identity: Partial<Identity>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!identity.firstName?.trim()) {
    issues.push({ field: "firstName", message: "First name is required." });
  }
  if (!identity.lastName?.trim()) {
    issues.push({ field: "lastName", message: "Last name is required." });
  }

  if (!identity.dateOfBirth || !ISO_DATE_RE.test(identity.dateOfBirth)) {
    issues.push({ field: "dateOfBirth", message: "Date of birth must be YYYY-MM-DD." });
  } else {
    const age = ageFromDob(identity.dateOfBirth);
    if (age === null) {
      issues.push({ field: "dateOfBirth", message: "Date of birth is invalid." });
    } else if (age < 18) {
      issues.push({ field: "dateOfBirth", message: "Applicant must be at least 18 years old." });
    } else if (age > 120) {
      issues.push({ field: "dateOfBirth", message: "Date of birth is out of range." });
    }
  }

  if (!identity.nationality || !COUNTRY_RE.test(identity.nationality)) {
    issues.push({ field: "nationality", message: "Nationality must be a 2-letter country code." });
  }
  if (!identity.country || !COUNTRY_RE.test(identity.country)) {
    issues.push({ field: "country", message: "Country must be a 2-letter country code." });
  }

  if (!identity.email || !EMAIL_RE.test(identity.email)) {
    issues.push({ field: "email", message: "A valid email is required." });
  }
  if (!identity.phone || !PHONE_RE.test(identity.phone)) {
    issues.push({ field: "phone", message: "A valid phone number is required." });
  }

  if (!identity.addressLine1?.trim()) {
    issues.push({ field: "addressLine1", message: "Address line 1 is required." });
  }
  if (!identity.city?.trim()) {
    issues.push({ field: "city", message: "City is required." });
  }
  if (!identity.postalCode?.trim()) {
    issues.push({ field: "postalCode", message: "Postal code is required." });
  }

  return issues;
}

export function hasRequiredDocuments(types: DocumentType[]): boolean {
  const set = new Set(types);
  const hasId = set.has("passport") || set.has("national_id") || set.has("drivers_license");
  const hasAddress = set.has("proof_of_address");
  return hasId && hasAddress;
}

export function canSubmitApplication(input: {
  identity: Identity | null;
  documentTypes: DocumentType[];
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!input.identity) {
    issues.push({ field: "identity", message: "Identity details are required before submit." });
    return issues;
  }
  issues.push(...validateIdentity(input.identity));
  if (!hasRequiredDocuments(input.documentTypes)) {
    issues.push({
      field: "documents",
      message: "Upload one government ID and proof of address before submit.",
    });
  }
  return issues;
}
