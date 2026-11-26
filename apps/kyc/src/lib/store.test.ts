import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeDataKey, decryptUtf8, encryptUtf8 } from "./at-rest";
import { createDraftApplication } from "./domain/application";
import type { Identity } from "./domain/types";
import {
  DEFAULT_APPROVED_RETENTION_DAYS,
  deleteApplication,
  getApplication,
  isPastRetention,
  listApplications,
  PII_RETENTION_DAYS,
  purgeExpiredApplications,
  readStore,
  replaceAllApplications,
  saveApplication,
} from "./store";

/** Test-only AES-256 key. Never use this value outside vitest. */
const TEST_ONLY_KYC_DATA_KEY = Buffer.alloc(32, 0x11).toString("base64");

const identity: Identity = {
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

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "kyc-store-"));
  process.env.KYC_DATA_DIR = dir;
  process.env.KYC_DATA_KEY = TEST_ONLY_KYC_DATA_KEY;
  delete process.env.KYC_STORE_WRITE_DELAY_MS;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  delete process.env.KYC_STORE_WRITE_DELAY_MS;
  delete process.env.KYC_ALLOW_LOCAL_STORE;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("encrypted store", () => {
  it("encrypts PII at rest and round-trips occupation when present", async () => {
    const app = createDraftApplication({
      identity: { ...identity, occupationCategory: "Other", occupation: "Teacher" },
    });
    await saveApplication(app);
    const raw = await fs.readFile(path.join(dir, "store.json"), "utf8");
    expect(raw.startsWith("KYCENC1.")).toBe(true);
    expect(raw).not.toContain(identity.email);
    expect(raw).not.toContain("Teacher");
    expect(raw).not.toContain(identity.firstName);

    const loaded = await getApplication(app.id);
    expect(loaded?.identity?.email).toBe(identity.email);
    expect(loaded?.identity?.occupationCategory).toBe("Other");
    expect(loaded?.identity?.occupation).toBe("Teacher");
    expect(loaded?.createdBy).toBeNull();
    expect(loaded?.decidedBy).toBeNull();

    const leftovers = (await fs.readdir(dir)).filter((name) => name.includes(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("keeps records that omit occupation (backfill)", async () => {
    const app = createDraftApplication({ identity });
    expect(app.identity?.occupation).toBeUndefined();
    await saveApplication(app);
    const loaded = await getApplication(app.id);
    expect(loaded?.identity?.occupation).toBeUndefined();
    expect(loaded?.identity?.lastName).toBe("Lee");
  });

  it("fails closed without a key and does not write plaintext", async () => {
    delete process.env.KYC_DATA_KEY;
    const app = createDraftApplication({ identity });
    await expect(saveApplication(app)).rejects.toThrow(/KYC_DATA_KEY/);
    await expect(fs.access(path.join(dir, "store.json"))).rejects.toThrow();
  });

  it("refuses a plaintext store and does not overwrite it", async () => {
    const file = path.join(dir, "store.json");
    const plaintext = JSON.stringify({
      applications: [{ identity: { email: "secret@example.com" } }],
    });
    await fs.writeFile(file, plaintext);
    await expect(readStore()).rejects.toThrow(/plaintext/);
    expect(await fs.readFile(file, "utf8")).toBe(plaintext);
  });

  it("does not replace a store that fails authentication", async () => {
    const app = createDraftApplication({ identity });
    await saveApplication(app);
    const file = path.join(dir, "store.json");
    const raw = await fs.readFile(file, "utf8");
    const damaged = `${raw.slice(0, -8)}AAAAAAAA`;
    await fs.writeFile(file, damaged);
    await expect(readStore()).rejects.toThrow(/authentication/);
    expect(await fs.readFile(file, "utf8")).toBe(damaged);
  });

  it("serializes concurrent saves so neither write is lost", async () => {
    process.env.KYC_STORE_WRITE_DELAY_MS = "25";
    const apps = Array.from({ length: 6 }, (_, index) =>
      createDraftApplication({
        identity: { ...identity, email: `person${index}@example.com` },
      }),
    );
    await Promise.all(apps.map((app) => saveApplication(app)));
    const ids = (await listApplications()).map((app) => app.id).sort();
    expect(ids).toEqual(apps.map((app) => app.id).sort());
  });

  it("deletes one application and purges records past the 90-day window", async () => {
    const stale = createDraftApplication({
      identity: { ...identity, email: "stale@example.com" },
    });
    stale.updatedAt = new Date(Date.now() - (PII_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    const fresh = createDraftApplication({
      identity: { ...identity, email: "fresh@example.com" },
    });
    expect(isPastRetention(stale)).toBe(true);
    expect(isPastRetention(fresh)).toBe(false);

    await saveApplication(stale);
    await saveApplication(fresh);
    const purged = await purgeExpiredApplications("analyst:northwind-demo");
    expect(purged).toEqual([stale.id]);
    expect(await getApplication(stale.id)).toBeNull();
    expect(await getApplication(fresh.id)).not.toBeNull();

    expect(await deleteApplication(fresh.id, "analyst:northwind-demo")).toEqual({ deleted: true });
    expect(await deleteApplication(fresh.id, "analyst:northwind-demo")).toEqual({
      deleted: false,
      reason: "missing",
    });
    const store = await readStore();
    expect(store.applications).toEqual([]);
    expect(store.retentionLog.map((event) => event.action)).toEqual(["purge", "delete"]);
    expect(store.retentionLog.every((event) => event.actorId === "analyst:northwind-demo")).toBe(true);
    expect(JSON.stringify(store.retentionLog)).not.toContain("example.com");
  });

  it("keeps approved records for the regulatory window and still purges old drafts and rejections", async () => {
    const day = 24 * 60 * 60 * 1000;
    const old = new Date(Date.now() - (PII_RETENTION_DAYS + 2) * day).toISOString();
    const approved = createDraftApplication({ identity: { ...identity, email: "approved@example.com" } });
    approved.status = "approved";
    approved.updatedAt = old;
    const rejected = createDraftApplication({ identity: { ...identity, email: "rejected@example.com" } });
    rejected.status = "rejected";
    rejected.updatedAt = old;
    const submitted = createDraftApplication({ identity: { ...identity, email: "submitted@example.com" } });
    submitted.status = "submitted";
    submitted.updatedAt = old;
    expect(isPastRetention(approved)).toBe(false);
    expect(isPastRetention(rejected)).toBe(true);
    expect(isPastRetention(submitted)).toBe(false);

    const agedOut = createDraftApplication({ identity: { ...identity, email: "aged@example.com" } });
    agedOut.status = "approved";
    agedOut.updatedAt = new Date(Date.now() - (DEFAULT_APPROVED_RETENTION_DAYS + 1) * day).toISOString();
    expect(isPastRetention(agedOut)).toBe(true);

    await saveApplication(approved);
    await saveApplication(rejected);
    await saveApplication(submitted);
    const purged = await purgeExpiredApplications("analyst:northwind-demo");
    expect(purged).toEqual([rejected.id]);
    expect(await getApplication(approved.id)).not.toBeNull();
    expect(await getApplication(submitted.id)).not.toBeNull();

    expect(await deleteApplication(approved.id, "analyst:northwind-demo")).toEqual({
      deleted: false,
      reason: "approved",
    });
    expect(await getApplication(approved.id)).not.toBeNull();
    expect(await deleteApplication(approved.id, "analyst:northwind-demo", { approvedOverride: true })).toEqual({
      deleted: true,
    });
    const store = await readStore();
    expect(store.retentionLog.some((event) => event.action === "delete-approved-override")).toBe(true);
  });

  it("appends a seed event onto the existing retention log", async () => {
    const app = createDraftApplication({ identity: { ...identity, email: "log@example.com" } });
    await saveApplication(app);
    await deleteApplication(app.id, "analyst:seed");
    await replaceAllApplications([], new Date().toISOString(), "analyst:seed");
    const store = await readStore();
    expect(store.retentionLog.map((event) => event.action)).toEqual(["delete", "seed-replace"]);
  });

  it("refuses the local store in production unless the demo flag is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.KYC_ALLOW_LOCAL_STORE;
    const app = createDraftApplication({ identity });
    await expect(saveApplication(app)).rejects.toThrow(/Local demo store is disabled/);
    vi.stubEnv("KYC_ALLOW_LOCAL_STORE", "true");
    await saveApplication(app);
    expect(await getApplication(app.id)).not.toBeNull();
    vi.unstubAllEnvs();
    process.env.KYC_DATA_KEY = TEST_ONLY_KYC_DATA_KEY;
    process.env.KYC_DATA_DIR = dir;
  });

  it("decodes a 32-byte hex key and round-trips ciphertext", () => {
    const hex = Buffer.alloc(32, 0xab).toString("hex");
    const key = decodeDataKey(hex);
    const payload = encryptUtf8('{"ok":true}', key);
    expect(decryptUtf8(payload, key)).toBe('{"ok":true}');
    expect(() => decodeDataKey("short")).toThrow(/32 bytes/);
  });
});
