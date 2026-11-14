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

    app = advanceReview(app, "in_review");
    app = advanceReview(app, "approved", "Looks good");
    expect(app.status).toBe("approved");
    expect(app.notes.at(-1)).toContain("Looks good");
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
    expect(() => advanceReview(app, "approved")).toThrow(/Invalid status transition/);
  });
});
