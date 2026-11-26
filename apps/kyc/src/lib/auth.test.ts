import { afterEach, describe, expect, it } from "vitest";
import { authenticateCredential, credentialFromRequest, INTAKE_ACTOR_ID, SESSION_COOKIE_NAME } from "./auth";

const CUSTOMER = "customer-test-token";
const ANALYST = "analyst-test-token";

afterEach(() => {
  delete process.env.KYC_CUSTOMER_TOKEN;
  delete process.env.KYC_ANALYST_TOKEN;
  delete process.env.KYC_ANALYST_ACTOR_ID;
  delete process.env.KYC_CUSTOMER_ACTOR_ID;
});

describe("KYC auth", () => {
  it("separates customer and analyst tokens and fails closed when unset", () => {
    process.env.KYC_CUSTOMER_TOKEN = CUSTOMER;
    process.env.KYC_ANALYST_TOKEN = ANALYST;
    expect(authenticateCredential(null)).toBeNull();
    expect(authenticateCredential("nope-token-value")).toBeNull();
    expect(authenticateCredential(CUSTOMER)).toEqual({
      role: "customer",
      actorId: INTAKE_ACTOR_ID,
    });
    expect(authenticateCredential(ANALYST)).toEqual({
      role: "analyst",
      actorId: "analyst:northwind-demo",
    });

    delete process.env.KYC_ANALYST_TOKEN;
    expect(() => authenticateCredential(CUSTOMER)).toThrow(/KYC_ANALYST_TOKEN/);
  });

  it("reads a bearer header before the session cookie", () => {
    process.env.KYC_CUSTOMER_TOKEN = CUSTOMER;
    process.env.KYC_ANALYST_TOKEN = ANALYST;
    const request = new Request("http://localhost/api/applications", {
      headers: {
        authorization: `Bearer ${ANALYST}`,
        cookie: `${SESSION_COOKIE_NAME}=${CUSTOMER}`,
      },
    });
    expect(credentialFromRequest(request)).toBe(ANALYST);
    expect(authenticateCredential(credentialFromRequest(request))?.role).toBe("analyst");
  });

  it("rejects identical role tokens", () => {
    process.env.KYC_CUSTOMER_TOKEN = CUSTOMER;
    process.env.KYC_ANALYST_TOKEN = CUSTOMER;
    expect(() => authenticateCredential(CUSTOMER)).toThrow(/must be different/);
  });
});
