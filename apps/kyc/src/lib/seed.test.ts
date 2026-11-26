import { describe, expect, it } from "vitest";
import { validateIdentity } from "./domain/validation";
import { buildSeedApplications } from "./seed";

describe("synthetic seed", () => {
  it("uses example identities, an occupation, and no document bytes", () => {
    const apps = buildSeedApplications(new Date("2026-01-15T00:00:00.000Z"));
    expect(apps).toHaveLength(4);
    for (const app of apps) {
      expect(app.identity).toBeTruthy();
      expect(validateIdentity(app.identity!)).toEqual([]);
      expect(app.identity?.occupation).toBeTruthy();
      expect(app.identity?.email).toMatch(/@example\.|@temp\.test$/);
      expect(app.createdBy).toBeNull();
      expect(JSON.stringify(app.documents)).not.toMatch(/base64|data:/i);
    }
    const approved = apps.find((app) => app.status === "approved");
    expect(approved?.decidedBy).toBe("analyst:seed");
    expect(approved?.notes.some((note) => note.includes("decidedBy: analyst:seed"))).toBe(true);
  });
});
