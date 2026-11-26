import { describe, expect, it } from "vitest";
import {
  addDocument,
  advanceReview,
  createDraftApplication,
  submitApplication,
} from "./application";
import type { Identity } from "./types";

const identity: Identity = {
  firstName: "Riley",
  lastName: "Chen",
  dateOfBirth: "1993-11-08",
  nationality: "US",
  email: "riley.chen@example.com",
  phone: "+1 646 555 0177",
  addressLine1: "88 Pine Street",
  city: "New York",
  postalCode: "10005",
  country: "US",
};

describe("KYC application lifecycle", () => {
  it("creates a draft with a Northwind reference", () => {
    const app = createDraftApplication({ identity }, new Date("2026-02-01T12:00:00.000Z"));
    expect(app.status).toBe("draft");
    expect(app.reference.startsWith("NW-")).toBe(true);
    expect(app.identity?.email).toBe(identity.email);
    expect(app.risk).toBeNull();
  });

  it("runs happy path draft → submit → review → approve", () => {
    let app = createDraftApplication({ identity });
    app = addDocument(app, { type: "passport", fileName: "passport.pdf" });
    app = addDocument(app, { type: "proof_of_address", fileName: "bill.pdf" });
    app = submitApplication(app);

    expect(app.status).toBe("submitted");
    expect(app.submittedAt).toBeTruthy();
    expect(app.risk).not.toBeNull();
    expect(app.documents[0]?.mockOcrSummary).toContain("MOCK OCR");

    app = advanceReview(app, "in_review", "analyst:test");
    app = advanceReview(app, "approved", "analyst:test", "Looks good");
    expect(app.status).toBe("approved");
    expect(app.decidedBy).toBe("analyst:test");
    expect(app.notes.at(-1)).toContain("Looks good");
    expect(app.notes.at(-1)).toContain("decidedBy: analyst:test");
  });

  it("rejects submit without required documents", () => {
    const app = createDraftApplication({ identity });
    expect(() => submitApplication(app)).toThrow(/proof of address|government ID/i);
  });

  it("rejects invalid status transitions", () => {
    let app = createDraftApplication({ identity });
    app = addDocument(app, { type: "passport", fileName: "passport.pdf" });
    app = addDocument(app, { type: "proof_of_address", fileName: "bill.pdf" });
    app = submitApplication(app);
    expect(() => advanceReview(app, "approved", "analyst:test")).toThrow(/Invalid status transition/);
  });

  it("stores optional occupation and rejects unknown identity keys", () => {
    const app = createDraftApplication({
      identity: { ...identity, occupationCategory: "Other", occupation: "  Teacher  " },
    });
    expect(app.identity?.occupationCategory).toBe("Other");
    expect(app.identity?.occupation).toBe("Teacher");
    expect(app.applicantCredentialHash).toBeNull();
    expect(app.createdBy).toBeNull();
    expect(app.decidedBy).toBeNull();
    expect(Object.keys(app.identity ?? {})).not.toContain("passportNumber");

    expect(() =>
      createDraftApplication({
        identity: { ...identity, passportNumber: "AB123456" },
      }),
    ).toThrow(/Unknown identity fields: passportNumber/);
  });

  it("rejects non-string identity values and requires an analyst actor", () => {
    expect(() =>
      createDraftApplication({
        identity: { ...identity, email: 42 },
      }),
    ).toThrow(/email must be a string/);

    const draft = createDraftApplication({ identity }, undefined, "customer:northwind-demo");
    expect(draft.createdBy).toBe("customer:northwind-demo");
    expect(() => advanceReview(draft, "in_review", " ")).toThrow(/decidedBy actor is required/);
  });
});
