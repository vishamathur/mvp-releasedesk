import { describe, expect, it } from "vitest";
import {
  canSubmitApplication,
  hasRequiredDocuments,
  parseIdentity,
  sanitizeStoredIdentity,
  validateIdentity,
} from "./validation";
import type { Identity } from "./types";

const valid: Identity = {
  firstName: "Jamie",
  lastName: "Lee",
  dateOfBirth: "1990-05-20",
  nationality: "US",
  email: "jamie.lee@example.com",
  phone: "+1 212 555 0101",
  addressLine1: "1 Wall Street",
  city: "New York",
  postalCode: "10005",
  country: "US",
};

describe("validateIdentity", () => {
  it("accepts a complete adult identity", () => {
    expect(validateIdentity(valid)).toEqual([]);
    expect(validateIdentity({ ...valid, postalCode: "EC4N 7BA", city: "St. Louis" })).toEqual([]);
    expect(validateIdentity({ ...valid, firstName: "Ann3" }).some((issue) => issue.field === "firstName")).toBe(
      true,
    );
  });

  it("rejects underage applicants", () => {
    const issues = validateIdentity({ ...valid, dateOfBirth: "2015-01-01" });
    expect(issues.some((i) => i.field === "dateOfBirth")).toBe(true);
  });

  it("accepts a missing occupation and a normal job title", () => {
    expect(validateIdentity(valid)).toEqual([]);
    expect(validateIdentity({ ...valid, occupation: "R&D Manager" })).toEqual([]);
    const parsed = parseIdentity({ ...valid, occupation: "" });
    expect(parsed.occupation).toBeUndefined();
  });

  it("rejects occupation that is too short, too long, or outside the charset", () => {
    expect(validateIdentity({ ...valid, occupation: "A" }).some((issue) => issue.field === "occupation")).toBe(
      true,
    );
    expect(
      validateIdentity({ ...valid, occupation: "N".repeat(81) }).some((issue) => issue.field === "occupation"),
    ).toBe(true);
    expect(
      validateIdentity({ ...valid, occupation: "Title <script>" }).some((issue) => issue.field === "occupation"),
    ).toBe(true);
  });

  it("enforces length and type checks on every identity field", () => {
    const tooLong = validateIdentity({
      ...valid,
      firstName: "A".repeat(81),
      lastName: "B".repeat(81),
      email: `${"a".repeat(250)}@example.com`,
      phone: "+123",
      addressLine1: "1".repeat(121),
      addressLine2: "2".repeat(121),
      city: "C".repeat(81),
      postalCode: "Z",
    });
    expect(tooLong.map((issue) => issue.field).sort()).toEqual(
      ["addressLine1", "addressLine2", "city", "email", "firstName", "lastName", "phone", "postalCode"].sort(),
    );

    const wrongType = validateIdentity({
      ...valid,
      firstName: 4 as unknown as string,
      phone: { n: 1 } as unknown as string,
    });
    expect(wrongType.find((issue) => issue.field === "firstName")?.message).toMatch(/string/);
    expect(wrongType.find((issue) => issue.field === "phone")?.message).toMatch(/string/);
  });

  it("allow-lists identity keys and drops unknown keys on stored records", () => {
    expect(() => parseIdentity({ ...valid, ssn: "000-00-0000" })).toThrow(/Unknown identity fields: ssn/);
    const stored = sanitizeStoredIdentity({
      ...valid,
      passportNumber: "SHOULD-NOT-SURVIVE",
      occupation: "Nurse (RN)",
    });
    expect(stored?.occupation).toBe("Nurse (RN)");
    expect(stored && "passportNumber" in stored).toBe(false);
    expect(sanitizeStoredIdentity({ ...valid, occupation: undefined })?.occupation).toBeUndefined();
  });

  it("rejects invalid email and country codes", () => {
    const issues = validateIdentity({
      ...valid,
      email: "not-an-email",
      nationality: "usa",
      country: "u",
    });
    expect(issues.map((i) => i.field).sort()).toEqual(
      ["country", "email", "nationality"].sort(),
    );
  });
});

describe("document requirements", () => {
  it("requires government ID and proof of address", () => {
    expect(hasRequiredDocuments(["passport"])).toBe(false);
    expect(hasRequiredDocuments(["passport", "proof_of_address"])).toBe(true);
    expect(hasRequiredDocuments(["national_id", "proof_of_address"])).toBe(true);
  });

  it("blocks submit without documents", () => {
    const issues = canSubmitApplication({
      identity: valid,
      documentTypes: ["selfie"],
    });
    expect(issues.some((i) => i.field === "documents")).toBe(true);
  });
});
