import { describe, expect, it } from "vitest";
import {
  canSubmitApplication,
  hasRequiredDocuments,
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
  });

  it("rejects underage applicants", () => {
    const issues = validateIdentity({ ...valid, dateOfBirth: "2015-01-01" });
    expect(issues.some((i) => i.field === "dateOfBirth")).toBe(true);
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
