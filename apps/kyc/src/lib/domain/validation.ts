import type { DocumentType, Identity } from "./types";

export interface ValidationIssue {
  field: string;
  message: string;
}

/** Explicit Identity allow-list. Create and update reject every other key. */
export const IDENTITY_KEYS = [
  "firstName",
  "lastName",
  "dateOfBirth",
  "nationality",
  "email",
  "phone",
  "addressLine1",
  "addressLine2",
  "city",
  "postalCode",
  "country",
  "occupation",
] as const;

export type IdentityKey = (typeof IDENTITY_KEYS)[number];

const IDENTITY_KEY_SET = new Set<string>(IDENTITY_KEYS);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s\-()]{8,20}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'’\-]*$/u;
const ADDRESS_RE = /^[\p{L}\p{M}0-9][\p{L}\p{M}0-9 #'’.,/\-]*$/u;
const CITY_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'’\-]*$/u;
const POSTAL_RE = /^[A-Za-z0-9][A-Za-z0-9 -]*$/;
const OCCUPATION_RE = /^[\p{L}\p{M}0-9][\p{L}\p{M}0-9 &'’.,()\-]*$/u;

export const IDENTITY_LIMITS = {
  firstName: { min: 1, max: 80 },
  lastName: { min: 1, max: 80 },
  email: { max: 254 },
  phone: { min: 8, max: 20 },
  addressLine1: { min: 1, max: 120 },
  addressLine2: { max: 120 },
  city: { min: 1, max: 80 },
  postalCode: { min: 2, max: 16 },
  occupation: { min: 2, max: 80 },
} as const;

export class IdentitySchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentitySchemaError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeKey(key: string): string {
  return key.slice(0, 40).replace(/[^\w.-]/g, "_");
}

function readString(input: Record<string, unknown>, field: string, present: boolean): string | undefined {
  if (!present) return undefined;
  const value = input[field];
  if (typeof value !== "string") {
    throw new IdentitySchemaError(`${field} must be a string`);
  }
  return value.trim();
}

/**
 * Copy only allow-listed Identity keys. Unknown keys and non-strings throw.
 * Empty optional strings are omitted. Length and charset rules run afterwards.
 */
export function parseIdentity(input: unknown): Identity {
  if (!isPlainObject(input)) {
    throw new IdentitySchemaError("identity must be an object");
  }
  const unknown = Object.keys(input)
    .filter((key) => !IDENTITY_KEY_SET.has(key))
    .map(safeKey)
    .sort();
  if (unknown.length > 0) {
    throw new IdentitySchemaError(`Unknown identity fields: ${unknown.slice(0, 8).join(", ")}`);
  }

  const identity: Identity = {
    firstName: readString(input, "firstName", "firstName" in input) ?? "",
    lastName: readString(input, "lastName", "lastName" in input) ?? "",
    dateOfBirth: readString(input, "dateOfBirth", "dateOfBirth" in input) ?? "",
    nationality: (readString(input, "nationality", "nationality" in input) ?? "").toUpperCase(),
    email: readString(input, "email", "email" in input) ?? "",
    phone: readString(input, "phone", "phone" in input) ?? "",
    addressLine1: readString(input, "addressLine1", "addressLine1" in input) ?? "",
    city: readString(input, "city", "city" in input) ?? "",
    postalCode: readString(input, "postalCode", "postalCode" in input) ?? "",
    country: (readString(input, "country", "country" in input) ?? "").toUpperCase(),
  };

  const addressLine2 = readString(input, "addressLine2", "addressLine2" in input);
  if (addressLine2) identity.addressLine2 = addressLine2;
  const occupation = readString(input, "occupation", "occupation" in input);
  if (occupation) identity.occupation = occupation;

  const issues = validateIdentity(identity);
  if (issues.length > 0) {
    throw new IdentitySchemaError(issues.map((issue) => `${issue.field}: ${issue.message}`).join("; "));
  }
  return identity;
}

/** Drop unknown keys when reading a stored record. Does not invent missing fields. */
export function sanitizeStoredIdentity(value: unknown): Identity | null {
  if (!isPlainObject(value)) return null;
  const required = [
    "firstName",
    "lastName",
    "dateOfBirth",
    "nationality",
    "email",
    "phone",
    "addressLine1",
    "city",
    "postalCode",
    "country",
  ] as const;
  const identity = {} as Identity;
  for (const key of required) {
    if (typeof value[key] !== "string") return null;
    identity[key] = value[key];
  }
  if (typeof value.addressLine2 === "string" && value.addressLine2.trim()) {
    identity.addressLine2 = value.addressLine2;
  }
  if (typeof value.occupation === "string" && value.occupation.trim()) {
    identity.occupation = value.occupation;
  }
  return identity;
}

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

function checkBounded(
  issues: ValidationIssue[],
  field: string,
  value: string,
  max: number,
  pattern: RegExp,
  lengthMessage: string,
  charsetMessage: string,
): void {
  if (value.length > max || (field === "postalCode" && value.length < IDENTITY_LIMITS.postalCode.min)) {
    issues.push({ field, message: lengthMessage });
    return;
  }
  if (!pattern.test(value)) {
    issues.push({ field, message: charsetMessage });
  }
}

export function validateIdentity(identity: Partial<Identity>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (typeof identity.firstName !== "string" || !identity.firstName.trim()) {
    issues.push({
      field: "firstName",
      message:
        typeof identity.firstName === "string" || identity.firstName === undefined
          ? "First name is required."
          : "First name must be a string.",
    });
  } else {
    checkBounded(
      issues,
      "firstName",
      identity.firstName,
      IDENTITY_LIMITS.firstName.max,
      NAME_RE,
      "First name must be 1–80 characters.",
      "First name may contain only letters, spaces, apostrophes, periods, and hyphens.",
    );
  }

  if (typeof identity.lastName !== "string" || !identity.lastName.trim()) {
    issues.push({
      field: "lastName",
      message:
        typeof identity.lastName === "string" || identity.lastName === undefined
          ? "Last name is required."
          : "Last name must be a string.",
    });
  } else {
    checkBounded(
      issues,
      "lastName",
      identity.lastName,
      IDENTITY_LIMITS.lastName.max,
      NAME_RE,
      "Last name must be 1–80 characters.",
      "Last name may contain only letters, spaces, apostrophes, periods, and hyphens.",
    );
  }

  if (typeof identity.dateOfBirth !== "string" || !ISO_DATE_RE.test(identity.dateOfBirth)) {
    issues.push({
      field: "dateOfBirth",
      message:
        typeof identity.dateOfBirth === "string" || identity.dateOfBirth === undefined
          ? "Date of birth must be YYYY-MM-DD."
          : "Date of birth must be a string.",
    });
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

  if (typeof identity.nationality !== "string" || !COUNTRY_RE.test(identity.nationality)) {
    issues.push({
      field: "nationality",
      message:
        typeof identity.nationality === "string" || identity.nationality === undefined
          ? "Nationality must be a 2-letter country code."
          : "Nationality must be a string.",
    });
  }
  if (typeof identity.country !== "string" || !COUNTRY_RE.test(identity.country)) {
    issues.push({
      field: "country",
      message:
        typeof identity.country === "string" || identity.country === undefined
          ? "Country must be a 2-letter country code."
          : "Country must be a string.",
    });
  }

  if (typeof identity.email !== "string" || !identity.email || identity.email.length > IDENTITY_LIMITS.email.max || !EMAIL_RE.test(identity.email)) {
    issues.push({
      field: "email",
      message:
        typeof identity.email === "string" || identity.email === undefined
          ? "A valid email is required (max 254 characters)."
          : "Email must be a string.",
    });
  }
  if (
    typeof identity.phone !== "string" ||
    identity.phone.length < IDENTITY_LIMITS.phone.min ||
    identity.phone.length > IDENTITY_LIMITS.phone.max ||
    !PHONE_RE.test(identity.phone)
  ) {
    issues.push({
      field: "phone",
      message:
        typeof identity.phone === "string" || identity.phone === undefined
          ? "Phone must be 8–20 characters and contain only digits, spaces, and + - ( )."
          : "Phone must be a string.",
    });
  }

  if (typeof identity.addressLine1 !== "string" || !identity.addressLine1.trim()) {
    issues.push({
      field: "addressLine1",
      message:
        typeof identity.addressLine1 === "string" || identity.addressLine1 === undefined
          ? "Address line 1 is required."
          : "Address line 1 must be a string.",
    });
  } else {
    checkBounded(
      issues,
      "addressLine1",
      identity.addressLine1,
      IDENTITY_LIMITS.addressLine1.max,
      ADDRESS_RE,
      "Address line 1 must be 1–120 characters.",
      "Address line 1 may contain only letters, numbers, spaces, and # ' . , / -.",
    );
  }

  if (identity.addressLine2 !== undefined && identity.addressLine2 !== "") {
    if (typeof identity.addressLine2 !== "string") {
      issues.push({ field: "addressLine2", message: "Address line 2 must be a string." });
    } else if (identity.addressLine2.length > IDENTITY_LIMITS.addressLine2.max || !ADDRESS_RE.test(identity.addressLine2)) {
      issues.push({
        field: "addressLine2",
        message: "Address line 2 must be at most 120 characters and use letters, numbers, spaces, and # ' . , / -.",
      });
    }
  }

  if (typeof identity.city !== "string" || !identity.city.trim()) {
    issues.push({
      field: "city",
      message:
        typeof identity.city === "string" || identity.city === undefined
          ? "City is required."
          : "City must be a string.",
    });
  } else {
    checkBounded(
      issues,
      "city",
      identity.city,
      IDENTITY_LIMITS.city.max,
      CITY_RE,
      "City must be 1–80 characters.",
      "City may contain only letters, spaces, apostrophes, periods, and hyphens.",
    );
  }

  if (typeof identity.postalCode !== "string" || !identity.postalCode.trim()) {
    issues.push({
      field: "postalCode",
      message:
        typeof identity.postalCode === "string" || identity.postalCode === undefined
          ? "Postal code is required."
          : "Postal code must be a string.",
    });
  } else {
    checkBounded(
      issues,
      "postalCode",
      identity.postalCode,
      IDENTITY_LIMITS.postalCode.max,
      POSTAL_RE,
      "Postal code must be 2–16 letters, numbers, spaces, or hyphens.",
      "Postal code must be 2–16 letters, numbers, spaces, or hyphens.",
    );
  }

  if (identity.occupation !== undefined && identity.occupation !== "") {
    if (typeof identity.occupation !== "string") {
      issues.push({ field: "occupation", message: "Occupation must be a string." });
    } else if (
      identity.occupation.length < IDENTITY_LIMITS.occupation.min ||
      identity.occupation.length > IDENTITY_LIMITS.occupation.max
    ) {
      issues.push({ field: "occupation", message: "Occupation must be 2–80 characters." });
    } else if (!OCCUPATION_RE.test(identity.occupation)) {
      issues.push({
        field: "occupation",
        message: "Occupation may contain only letters, numbers, spaces, and & ' . , ( ) -.",
      });
    }
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
