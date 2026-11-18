import {
  addDocument,
  advanceReview,
  createDraftApplication,
  submitApplication,
} from "./domain/application";
import type { Identity, KycApplication } from "./domain/types";
import { replaceAllApplications } from "./store";

function identity(partial: Identity): Identity {
  return partial;
}

/**
 * Builds sample Northwind Bank KYC applications across common statuses.
 */
export function buildSeedApplications(now = new Date()): KycApplication[] {
  const t0 = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  const t1 = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const t2 = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

  let approved = createDraftApplication(
    {
      identity: identity({
        firstName: "Ava",
        lastName: "Nguyen",
        dateOfBirth: "1991-04-12",
        nationality: "US",
        email: "ava.nguyen@example.com",
        phone: "+1 415 555 0142",
        addressLine1: "120 Market Street",
        city: "San Francisco",
        postalCode: "94105",
        country: "US",
      }),
    },
    t0,
  );
  approved = addDocument(approved, { type: "passport", fileName: "ava-passport.pdf" }, t0);
  approved = addDocument(approved, { type: "proof_of_address", fileName: "ava-utility.pdf" }, t0);
  approved = addDocument(approved, { type: "selfie", fileName: "ava-selfie.jpg" }, t0);
  approved = submitApplication(approved, t0);
  approved = advanceReview(approved, "in_review", "Analyst queue pick-up", t1);
  approved = advanceReview(approved, "approved", "Identity consistent; low risk", t1);

  let inReview = createDraftApplication(
    {
      identity: identity({
        firstName: "Marcus",
        lastName: "Okoye",
        dateOfBirth: "1985-09-03",
        nationality: "GB",
        email: "marcus.okoye@example.co.uk",
        phone: "+44 20 7946 0958",
        addressLine1: "14 King William Street",
        city: "London",
        postalCode: "EC4N 7BA",
        country: "GB",
      }),
    },
    t1,
  );
  inReview = addDocument(inReview, { type: "national_id", fileName: "marcus-id.pdf" }, t1);
  inReview = addDocument(
    inReview,
    { type: "proof_of_address", fileName: "marcus-bank-statement.pdf" },
    t1,
  );
  inReview = submitApplication(inReview, t1);
  inReview = advanceReview(inReview, "in_review", "Manual review for cross-border residency", t2);

  let draft = createDraftApplication(
    {
      identity: identity({
        firstName: "Sofia",
        lastName: "Martinez",
        dateOfBirth: "1998-01-22",
        nationality: "ES",
        email: "sofia.martinez@example.es",
        phone: "+34 612 555 019",
        addressLine1: "Calle de Alcalá 45",
        city: "Madrid",
        postalCode: "28014",
        country: "ES",
      }),
    },
    t2,
  );
  draft = addDocument(draft, { type: "drivers_license", fileName: "sofia-license.jpg" }, t2);

  let highRisk = createDraftApplication(
    {
      identity: identity({
        firstName: "Demo",
        lastName: "Elevated",
        dateOfBirth: "2006-06-01",
        nationality: "XX",
        email: "demo.elevated@temp.test",
        phone: "+99 555 0100",
        addressLine1: "1 Demo Lane",
        city: "Demo City",
        postalCode: "00000",
        country: "ZZ",
      }),
    },
    t2,
  );
  highRisk = addDocument(highRisk, { type: "passport", fileName: "demo-passport.pdf" }, t2);
  highRisk = addDocument(highRisk, { type: "proof_of_address", fileName: "demo-poa.pdf" }, t2);
  highRisk = submitApplication(highRisk, t2);

  return [approved, inReview, draft, highRisk];
}

export async function seedStore(now = new Date()) {
  const applications = buildSeedApplications(now);
  return replaceAllApplications(applications, now.toISOString());
}
