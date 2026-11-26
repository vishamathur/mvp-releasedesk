import { describe, expect, it } from "vitest";
import { assessRisk } from "./risk";
import type { Identity } from "./types";

const base: Identity = {
  firstName: "Pat",
  lastName: "Kim",
  dateOfBirth: "1988-03-15",
  nationality: "US",
  email: "pat.kim@example.com",
  phone: "+1 312 555 0199",
  addressLine1: "200 W Madison",
  city: "Chicago",
  postalCode: "60606",
  country: "US",
};

describe("assessRisk", () => {
  it("scores a complete domestic profile as low risk", () => {
    const risk = assessRisk({
      identity: base,
      documentCount: 3,
      hasSelfie: true,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(risk.level).toBe("low");
    expect(risk.score).toBeLessThan(40);
    expect(risk.mockScreeningNote).toContain("MOCK");
  });

  it("flags elevated demo nationality / residence as high risk", () => {
    const risk = assessRisk({
      identity: {
        ...base,
        dateOfBirth: "2006-06-01",
        nationality: "XX",
        country: "ZZ",
        email: "user@temp.test",
      },
      documentCount: 2,
      hasSelfie: false,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(risk.level).toBe("high");
    expect(risk.score).toBeGreaterThanOrEqual(70);
    expect(risk.factors.length).toBeGreaterThan(2);
  });

  it("does not change the score when an optional occupation is present", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const without = assessRisk({
      identity: base,
      documentCount: 3,
      hasSelfie: true,
      now,
    });
    const withOccupation = assessRisk({
      identity: { ...base, occupation: "Teacher" },
      documentCount: 3,
      hasSelfie: true,
      now,
    });
    expect(withOccupation.score).toBe(without.score);
    expect(withOccupation.level).toBe(without.level);
  });

  it("treats nationality ≠ residence as a medium signal", () => {
    const risk = assessRisk({
      identity: { ...base, nationality: "CA", country: "US" },
      documentCount: 2,
      hasSelfie: false,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(["medium", "low"]).toContain(risk.level);
    expect(risk.factors.some((f) => f.includes("Nationality differs"))).toBe(true);
  });
});
