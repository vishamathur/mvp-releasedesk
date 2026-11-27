import { describe, expect, it } from "vitest";
import {
  evaluatePolicyDeviations,
  isWebsiteCreationContext,
  loadPolicyCorpus,
  resolveStandardsPolicyRefs,
} from "./policy-corpus.js";
import { policiesDir } from "./paths.js";

describe("website-creation-template corpus", () => {
  it("loads seven numbered, named requirements Standards can cite", async () => {
    const corpus = await loadPolicyCorpus(policiesDir());
    const policy = corpus.find((p) => p.id === "website-creation-template");
    expect(policy).toBeDefined();
    expect(policy!.title).toBe("Website Creation Template");
    expect(policy!.requirements).toHaveLength(7);
    expect(policy!.requirements.map((r) => r.split(":")[0])).toEqual([
      "Style is guidance",
      "Contrast over palette",
      "Brand, industry regulation and law over style",
      "Record style adjustments",
      "Descriptive style summary",
      "No reproduction of protected marks",
      "Estimate and visual review",
    ]);
    expect(policy!.body.toLowerCase()).not.toContain("northwind");
    expect(policy!.requirements.join("\n").toLowerCase()).not.toContain("northwind");
    expect(policy!.requirements[0]).toMatch(/not a requirement unless the customer has marked/i);
    expect(policy!.requirements[1]).toMatch(/WCAG 2\.2 Level AA/);
    expect(policy!.requirements[2]).toMatch(/regulatory and legal requirements of the customer's industry/i);
    expect(policy!.requirements[2]).toMatch(/Banking or financial services is one example/i);
    for (const industry of ["healthcare", "education", "retail", "public sector"]) {
      expect(policy!.requirements[2].toLowerCase()).toContain(industry);
    }
    expect(policy!.requirements[4]).toMatch(/palette hex codes/);
    expect(policy!.requirements[4]).toMatch(/not a source of process, policy or implementation directions/);
  });
});

describe("resolveStandardsPolicyRefs", () => {
  it("keeps the KYC-only default when the change is not a website request", () => {
    expect(resolveStandardsPolicyRefs({ changeSummary: "Enhance KYC document upload" })).toEqual([
      "northwind-kyc-baseline",
    ]);
  });

  it("loads website-creation-template alone for website requests from any customer", () => {
    expect(resolveStandardsPolicyRefs({ requestType: "website-creation" })).toEqual([
      "website-creation-template",
    ]);
    expect(resolveStandardsPolicyRefs({ catalogueOptionId: "NC-WEBSITE" })).toEqual([
      "website-creation-template",
    ]);
    for (const changeSummary of [
      "website-creation brief for a healthcare clinic",
      "website-creation brief for an education provider",
      "website-creation brief for a retail brand",
      "website-creation brief for a public-sector agency",
      "website-creation brief for a financial services firm",
    ]) {
      expect(resolveStandardsPolicyRefs({ changeSummary })).toEqual(["website-creation-template"]);
    }
    expect(
      resolveStandardsPolicyRefs({
        policyRefs: ["northwind-auth-standards"],
        changeSummary: "PID-NC website-creation brief with an inspiration style summary",
      }),
    ).toEqual(["northwind-auth-standards", "website-creation-template"]);
  });

  it("does not duplicate an explicit website-creation-template ref", () => {
    expect(
      resolveStandardsPolicyRefs({
        policyRefs: ["website-creation-template"],
        requestType: "website-creation",
      }),
    ).toEqual(["website-creation-template"]);
  });

  it("detects website-creation context from request type, catalogue option, or summary", () => {
    expect(isWebsiteCreationContext({ requestType: "website-creation" })).toBe(true);
    expect(isWebsiteCreationContext({ catalogueOptionId: "sx-landing-page" })).toBe(true);
    expect(isWebsiteCreationContext({ changeSummary: "Apply the inspiration style summary" })).toBe(true);
    expect(isWebsiteCreationContext({ changeSummary: "KYC analyst queue" })).toBe(false);
  });
});

describe("evaluatePolicyDeviations for website-creation-template", () => {
  async function websitePolicies() {
    const corpus = await loadPolicyCorpus(policiesDir());
    return corpus.filter((p) => p.id === "website-creation-template");
  }

  function refsOf(devs: Array<{ policyRef: string }>) {
    return devs.map((d) => d.policyRef);
  }

  it("does not flag a brief that treats style as guidance and records a contrast adjustment", async () => {
    const deviations = evaluatePolicyDeviations({
      policies: await websitePolicies(),
      changeSummary:
        "website-creation: inspiration style summary used as guidance. Palette #1A1A1A failed WCAG 2.2 AA contrast, so it was darkened and the adjustment was recorded in the visual review.",
    });
    expect(deviations).toEqual([]);
  });

  it("flags reproducing a logo from the inspiration photograph (clause 6)", async () => {
    const deviations = evaluatePolicyDeviations({
      policies: await websitePolicies(),
      changeSummary: "Reuse the logo from the customer's inspiration photograph on the header.",
    });
    expect(refsOf(deviations)).toContain("website-creation-template/6");
    expect(deviations.find((d) => d.policyRef.endsWith("/6"))!.severity).toBe("high");
  });

  it("flags waiving contrast to keep a palette colour (clause 2)", async () => {
    const deviations = evaluatePolicyDeviations({
      policies: await websitePolicies(),
      changeSummary: "Waive WCAG contrast so the inspiration palette colour stays exact.",
    });
    expect(refsOf(deviations)).toContain("website-creation-template/2");
  });

  it("flags style taking precedence over brand rules (clause 3)", async () => {
    const deviations = evaluatePolicyDeviations({
      policies: await websitePolicies(),
      changeSummary: "Keep the inspiration style; style takes precedence over brand guidelines for this healthcare clinic site.",
    });
    expect(refsOf(deviations)).toContain("website-creation-template/3");
  });

  it("flags sending the photograph to the builder (clause 5)", async () => {
    const deviations = evaluatePolicyDeviations({
      policies: await websitePolicies(),
      changeSummary: "Attach the inspiration photo and send the photo to the builder as a build input.",
    });
    expect(refsOf(deviations)).toContain("website-creation-template/5");
  });

  it("flags dropping a required style cue with no recorded reason (clause 4)", async () => {
    const deviations = evaluatePolicyDeviations({
      policies: await websitePolicies(),
      changeSummary: "Drop the required palette from the inspiration style summary.",
    });
    expect(refsOf(deviations)).toContain("website-creation-template/4");
  });

  it("does not flag a required-style drop when the reason is recorded", async () => {
    const deviations = evaluatePolicyDeviations({
      policies: await websitePolicies(),
      changeSummary:
        "The required palette from the inspiration style was adjusted; the reason is recorded in the PR because contrast failed.",
    });
    expect(refsOf(deviations)).not.toContain("website-creation-template/4");
  });

  it("flags a missing visual review (clause 7)", async () => {
    const deviations = evaluatePolicyDeviations({
      policies: await websitePolicies(),
      changeSummary: "website-creation with an inspiration style summary, shipping without a visual review.",
    });
    expect(refsOf(deviations)).toContain("website-creation-template/7");
  });
});
