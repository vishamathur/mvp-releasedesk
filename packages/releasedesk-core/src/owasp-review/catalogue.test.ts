import { describe, expect, it } from "vitest";
import { OWASP_CONTROLS, OWASP_CONTROL_IDS } from "./catalogue.js";

describe("OWASP catalogue", () => {
  it("contains exactly these 26 ids", () => {
    expect(OWASP_CONTROL_IDS).toEqual([
      "A01",
      "A02",
      "A03",
      "A04",
      "A05",
      "A06",
      "A07",
      "A08",
      "A09",
      "A10",
      "X01",
      "X02",
      "X03",
      "X04",
      "X05",
      "X06",
      "LLM01",
      "LLM02",
      "LLM03",
      "LLM04",
      "LLM05",
      "LLM06",
      "LLM07",
      "LLM08",
      "LLM09",
      "LLM10",
    ]);
    expect(OWASP_CONTROLS.map((control) => control.id)).toEqual([...OWASP_CONTROL_IDS]);
    expect(OWASP_CONTROL_IDS).not.toContain("X07");
  });

  it("uses the 2021 Top 10 names, the extra code-review ids, and the 2023 LLM names", () => {
    const names = Object.fromEntries(OWASP_CONTROLS.map((control) => [control.id, control.name]));
    expect(names.A01).toBe("Broken Access Control");
    expect(names.A02).toBe("Cryptographic Failures");
    expect(names.A03).toBe("Injection");
    expect(names.A04).toBe("Insecure Design");
    expect(names.A05).toBe("Security Misconfiguration");
    expect(names.A06).toBe("Vulnerable and Outdated Components");
    expect(names.A07).toBe("Identification and Authentication Failures");
    expect(names.A08).toBe("Software and Data Integrity Failures");
    expect(names.A09).toBe("Security Logging and Monitoring Failures");
    expect(names.A10).toMatch(/SSRF/);
    expect(names.X01).toMatch(/Hard-coded secrets/);
    expect(names.X02).toBe("Input validation");
    expect(names.X03).toBe("Session management");
    expect(names.X04).toMatch(/Error handling/);
    expect(names.X05).toMatch(/path traversal/);
    expect(names.X06).toMatch(/mass assignment/);
    expect(names.LLM01).toBe("Prompt Injection");
    expect(names.LLM02).toBe("Insecure Output Handling");
    expect(names.LLM03).toBe("Training Data Poisoning");
    expect(names.LLM04).toBe("Model Denial of Service");
    expect(names.LLM05).toBe("Supply Chain Vulnerabilities");
    expect(names.LLM06).toBe("Sensitive Information Disclosure");
    expect(names.LLM07).toBe("Insecure Plugin Design");
    expect(names.LLM08).toBe("Excessive Agency");
    expect(names.LLM09).toBe("Overreliance");
    expect(names.LLM10).toBe("Model Theft");
  });
});
