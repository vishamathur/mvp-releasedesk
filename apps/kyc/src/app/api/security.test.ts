import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login, DELETE as logout } from "@/app/api/auth/session/route";
import { GET as listApplications, POST as createApplication } from "@/app/api/applications/route";
import { DELETE as removeApplication, GET as getApplication, PATCH as patchApplication } from "@/app/api/applications/[id]/route";
import { POST as addDocument } from "@/app/api/applications/[id]/documents/route";
import { POST as submitApplication } from "@/app/api/applications/[id]/submit/route";
import { POST as purgeRetention } from "@/app/api/retention/purge/route";
import { POST as seed } from "@/app/api/seed/route";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import type { Identity } from "@/lib/domain/types";

/** Test-only AES-256 key. Never use this value outside vitest. */
const TEST_ONLY_KYC_DATA_KEY = Buffer.alloc(32, 0x11).toString("base64");
const CUSTOMER = "customer-test-token";
const ANALYST = "analyst-test-token";

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
  occupation: "Teacher",
};

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "kyc-api-"));
  process.env.KYC_DATA_DIR = dir;
  process.env.KYC_DATA_KEY = TEST_ONLY_KYC_DATA_KEY;
  process.env.KYC_CUSTOMER_TOKEN = CUSTOMER;
  process.env.KYC_ANALYST_TOKEN = ANALYST;
  delete process.env.KYC_CUSTOMER_ACTOR_ID;
  delete process.env.KYC_ANALYST_ACTOR_ID;
  delete process.env.KYC_SEED_ENABLED;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(dir, { recursive: true, force: true });
});

function call(path: string, token: string | null, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`http://localhost${path}`, { ...init, headers });
}

async function createOwned() {
  const response = await createApplication(
    call("/api/applications", CUSTOMER, {
      method: "POST",
      body: JSON.stringify({ identity }),
    }),
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as { application: { id: string; decidedBy: string | null; createdBy: string } };
  return body.application;
}

describe("KYC API authentication and schema", () => {
  it("hides the queue from anonymous callers and customers, and lets an analyst read it", async () => {
    const created = await createOwned();
    expect(created.createdBy).toBe("customer:northwind-demo");
    expect(created.decidedBy).toBeNull();

    const anonymous = await listApplications(call("/api/applications", null));
    expect(anonymous.status).toBe(401);
    expect(JSON.stringify(await anonymous.json())).not.toContain("example.com");

    const customerList = await listApplications(call("/api/applications", CUSTOMER));
    expect(customerList.status).toBe(403);

    const customerGet = await getApplication(call(`/api/applications/${created.id}`, CUSTOMER), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(customerGet.status).toBe(403);

    const analystList = await listApplications(call("/api/applications", ANALYST));
    expect(analystList.status).toBe(200);
    const listed = (await analystList.json()) as { applications: { id: string; identity: Identity }[] };
    expect(listed.applications[0]?.identity.occupation).toBe("Teacher");
  });

  it("rejects unknown identity keys, bad types, and analyst use of the customer create route", async () => {
    const extra = await createApplication(
      call("/api/applications", CUSTOMER, {
        method: "POST",
        body: JSON.stringify({ identity: { ...identity, ssn: "000-00-0000" } }),
      }),
    );
    expect(extra.status).toBe(400);
    expect((await extra.json()).error).toMatch(/Unknown identity fields: ssn/);

    const wrongType = await createApplication(
      call("/api/applications", CUSTOMER, {
        method: "POST",
        body: JSON.stringify({ identity: { ...identity, phone: 15551212 } }),
      }),
    );
    expect(wrongType.status).toBe(400);
    expect((await wrongType.json()).error).toMatch(/phone must be a string/);

    const tooLong = await createApplication(
      call("/api/applications", CUSTOMER, {
        method: "POST",
        body: JSON.stringify({ identity: { ...identity, occupation: "X".repeat(81) } }),
      }),
    );
    expect(tooLong.status).toBe(400);
    expect((await tooLong.json()).error).toMatch(/occupation/);

    const analystCreate = await createApplication(
      call("/api/applications", ANALYST, {
        method: "POST",
        body: JSON.stringify({ identity }),
      }),
    );
    expect(analystCreate.status).toBe(403);
  });

  it("attributes analyst decisions to the authenticated actor and ignores client decidedBy", async () => {
    const created = await createOwned();
    const unknownUpdate = await patchApplication(
      call(`/api/applications/${created.id}`, CUSTOMER, {
        method: "PATCH",
        body: JSON.stringify({ identity: { ...identity, govId: "SECRET" } }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(unknownUpdate.status).toBe(400);
    expect((await unknownUpdate.json()).error).toMatch(/Unknown identity fields: govId/);

    const analystIdentity = await patchApplication(
      call(`/api/applications/${created.id}`, ANALYST, {
        method: "PATCH",
        body: JSON.stringify({ identity }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(analystIdentity.status).toBe(403);

    await addDocument(
      call(`/api/applications/${created.id}/documents`, CUSTOMER, {
        method: "POST",
        body: JSON.stringify({ type: "passport", fileName: "passport.pdf" }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    await addDocument(
      call(`/api/applications/${created.id}/documents`, CUSTOMER, {
        method: "POST",
        body: JSON.stringify({ type: "proof_of_address", fileName: "bill.pdf" }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    const submitted = await submitApplication(call(`/api/applications/${created.id}/submit`, CUSTOMER, { method: "POST" }), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(submitted.status).toBe(200);

    const customerDecision = await patchApplication(
      call(`/api/applications/${created.id}`, CUSTOMER, {
        method: "PATCH",
        body: JSON.stringify({ status: "approved", decidedBy: "customer:spoofed" }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(customerDecision.status).toBe(403);

    const analystDocuments = await addDocument(
      call(`/api/applications/${created.id}/documents`, ANALYST, {
        method: "POST",
        body: JSON.stringify({ type: "selfie", fileName: "selfie.jpg" }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(analystDocuments.status).toBe(403);

    const reviewed = await patchApplication(
      call(`/api/applications/${created.id}`, ANALYST, {
        method: "PATCH",
        body: JSON.stringify({
          status: "in_review",
          note: "Queue pick-up",
          decidedBy: "attacker",
        }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(reviewed.status).toBe(200);
    const reviewedBody = (await reviewed.json()) as { application: { decidedBy: string; notes: string[] } };
    expect(reviewedBody.application.decidedBy).toBe("analyst:northwind-demo");
    expect(reviewedBody.application.decidedBy).not.toBe("attacker");
    expect(reviewedBody.application.notes.at(-1)).toContain("decidedBy: analyst:northwind-demo");
  });

  it("lets only an analyst delete, and only outside production when seed is explicitly enabled", async () => {
    const created = await createOwned();
    const customerDelete = await removeApplication(call(`/api/applications/${created.id}`, CUSTOMER, { method: "DELETE" }), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(customerDelete.status).toBe(403);
    const removed = await removeApplication(call(`/api/applications/${created.id}`, ANALYST, { method: "DELETE" }), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ deleted: true, id: created.id });
    const gone = await getApplication(call(`/api/applications/${created.id}`, ANALYST), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(gone.status).toBe(404);

    const anonymousSeed = await seed(call("/api/seed", null, { method: "POST" }));
    expect(anonymousSeed.status).toBe(401);

    const customerSeed = await seed(call("/api/seed", CUSTOMER, { method: "POST" }));
    expect(customerSeed.status).toBe(403);

    const disabled = await seed(call("/api/seed", ANALYST, { method: "POST" }));
    expect(disabled.status).toBe(403);
    expect((await disabled.json()).error).toMatch(/KYC_SEED_ENABLED/);

    process.env.KYC_SEED_ENABLED = "true";
    vi.stubEnv("NODE_ENV", "production");
    const production = await seed(call("/api/seed", ANALYST, { method: "POST" }));
    expect(production.status).toBe(403);
    expect((await production.json()).error).toMatch(/production/);

    vi.stubEnv("NODE_ENV", "test");
    const seeded = await seed(call("/api/seed", ANALYST, { method: "POST" }));
    expect(seeded.status).toBe(200);
    const seededBody = await seeded.json();
    expect(seededBody.count).toBe(4);
    expect(JSON.stringify(seededBody)).not.toContain("example.com");
    const raw = await fs.readFile(path.join(dir, "store.json"), "utf8");
    expect(raw.startsWith("KYCENC1.")).toBe(true);
    expect(raw).not.toContain("ava.nguyen@example.com");

    const seededList = (await (await listApplications(call("/api/applications", ANALYST))).json()) as {
      applications: { id: string }[];
    };
    const seededId = seededList.applications[0]?.id ?? "";
    const customerOnSeed = await addDocument(
      call(`/api/applications/${seededId}/documents`, CUSTOMER, {
        method: "POST",
        body: JSON.stringify({ type: "passport", fileName: "x.pdf" }),
      }),
      { params: Promise.resolve({ id: seededId }) },
    );
    expect(customerOnSeed.status).toBe(404);

    const purge = await purgeRetention(call("/api/retention/purge", CUSTOMER, { method: "POST" }));
    expect(purge.status).toBe(403);
    const analystPurge = await purgeRetention(call("/api/retention/purge", ANALYST, { method: "POST" }));
    expect(analystPurge.status).toBe(200);
  });

  it("returns 503 when tokens are not configured", async () => {
    delete process.env.KYC_CUSTOMER_TOKEN;
    delete process.env.KYC_ANALYST_TOKEN;
    const response = await listApplications(call("/api/applications", ANALYST));
    expect(response.status).toBe(503);
  });

  it("accepts an HttpOnly session cookie from the login route", async () => {
    const response = await login(
      call("/api/auth/session", null, {
        method: "POST",
        body: JSON.stringify({ token: ANALYST }),
      }),
    );
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(JSON.stringify(await response.clone().json())).not.toContain(ANALYST);

    const cookie = setCookie.split(";")[0] ?? "";
    const listed = await listApplications(
      new Request("http://localhost/api/applications", { headers: { cookie } }),
    );
    expect(listed.status).toBe(200);

    const signedOut = await logout();
    expect(signedOut.headers.get("set-cookie") ?? "").toContain(`${SESSION_COOKIE_NAME}=`);
  });
});
