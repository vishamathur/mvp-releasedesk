import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  createFileCustomerStore,
  createInMemoryCustomerStore,
  CUSTOMER_DB_PATH_ENV,
  defaultCustomerDbPath,
  demoCustomerInputs,
  FileCustomerStore,
  InMemoryCustomerStore,
  resolveCustomerDbPath,
  seedDemoCustomers,
  SEED_DEMO_CUSTOMERS_ENV,
  type CustomerStore,
} from "./customer-store.js";
import { createCustomerId, CustomerIdSchema } from "./intake.js";
import { DEMO_PORTFOLIO } from "./portfolio.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function tempDbPath(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  return path.join(dir, "customers.json");
}

function requestInput(
  customerId: string,
  id: string,
  title: string,
): {
  customerId: string;
  id: string;
  title: string;
  summary: string;
  requestedBy: string;
} {
  return {
    customerId,
    id,
    title,
    summary: `${title} summary`,
    requestedBy: "casey",
  };
}

function sharedStoreTests(label: string, open: () => Promise<CustomerStore>): void {
  describe(label, () => {
    it("starts empty", async () => {
      const store = await open();
      expect(await store.listCustomers()).toEqual([]);
    });

    it("upserts, gets, and lists customers by customerId", async () => {
      const store = await open();
      const created = await store.upsertCustomer({
        customerId: "cust_1042",
        name: "Acme",
      });
      expect(created.customerId).toBe("cust_1042");
      expect(created.weight).toBe(1);
      expect(CustomerIdSchema.parse(created.customerId)).toBe("cust_1042");

      await store.upsertCustomer({
        customerId: "cust_northwind",
        name: "Northwind Bank",
        weight: 2,
      });

      expect(await store.getCustomer("cust_1042")).toMatchObject({ name: "Acme" });
      expect(await store.getCustomer("cust_missing")).toBeUndefined();
      expect((await store.listCustomers()).map((customer) => customer.customerId)).toEqual([
        "cust_1042",
        "cust_northwind",
      ]);
    });

    it("keeps createdAt and bumps updatedAt on customer upsert", async () => {
      const store = await open();
      const created = await store.upsertCustomer({
        customerId: "cust_1042",
        name: "Acme",
        weight: 1,
      });
      await delay(15);
      const updated = await store.upsertCustomer({
        customerId: "cust_1042",
        name: "Acme Holdings",
        weight: 3,
      });
      expect(updated.createdAt).toBe(created.createdAt);
      expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
      expect(updated.name).toBe("Acme Holdings");
      expect(updated.weight).toBe(3);
      expect(await store.listCustomers()).toHaveLength(1);
    });

    it("rejects a customer id outside the canonical cust_* form", async () => {
      const store = await open();
      await expect(
        store.upsertCustomer({ customerId: "CUST-1042", name: "Nope" }),
      ).rejects.toThrow();
      expect(await store.listCustomers()).toEqual([]);
      await expect(store.getCustomer("CUST-1042")).rejects.toThrow();
    });

    it("stores and lists requests by customerId", async () => {
      const store = await open();
      await store.upsertCustomer({ customerId: "cust_1042", name: "Acme" });
      await store.upsertCustomer({ customerId: "cust_northwind", name: "Northwind Bank" });
      const created = await store.upsertRequest(
        requestInput("cust_1042", "creq_labels", "Rename labels"),
      );
      await store.upsertRequest(requestInput("cust_northwind", "creq_kyc", "KYC tweak"));
      await delay(15);
      const updated = await store.upsertRequest({
        ...requestInput("cust_1042", "creq_labels", "Rename two labels"),
        priorityHint: 2,
      });

      expect(updated.createdAt).toBe(created.createdAt);
      expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
      expect(updated.title).toBe("Rename two labels");
      expect(updated.priorityHint).toBe(2);
      expect(await store.getRequest("creq_labels")).toMatchObject({ customerId: "cust_1042" });
      expect((await store.listRequests("cust_1042")).map((request) => request.id)).toEqual([
        "creq_labels",
      ]);
      expect((await store.listRequests("cust_northwind")).map((request) => request.id)).toEqual([
        "creq_kyc",
      ]);
    });

    it("refuses a request whose customerId changes or whose customer is missing", async () => {
      const store = await open();
      await expect(
        store.upsertRequest(requestInput("cust_1042", "creq_labels", "Rename labels")),
      ).rejects.toThrow(/Unknown customerId/);
      await store.upsertCustomer({ customerId: "cust_1042", name: "Acme" });
      await store.upsertCustomer({ customerId: "cust_northwind", name: "Northwind Bank" });
      await store.upsertRequest(requestInput("cust_1042", "creq_labels", "Rename labels"));
      await expect(
        store.upsertRequest(requestInput("cust_northwind", "creq_labels", "Moved")),
      ).rejects.toThrow(/does not match/);
      expect((await store.getRequest("creq_labels"))?.customerId).toBe("cust_1042");
    });
  });
}

describe("customerId format", () => {
  it("accepts the canonical cust_* form used by cost records", () => {
    for (const customerId of ["cust_1042", "cust_northwind", "cust_contoso", "cust_fabrikam", "cust_a"]) {
      expect(CustomerIdSchema.parse(customerId)).toBe(customerId);
    }
    expect(CustomerIdSchema.parse("CUST_1042")).toBe("CUST_1042");
    expect(createCustomerId("Northwind Bank")).toMatch(/^cust_[a-z0-9][a-z0-9_-]*$/);
  });

  it("rejects the intake form's old CUST-1042 shape", () => {
    for (const customerId of ["CUST-1042", "cust-1042", "cust_", "cust", "", "cust_1042 "]) {
      expect(() => CustomerIdSchema.parse(customerId)).toThrow();
    }
  });
});

describe("customer store", () => {
  sharedStoreTests("in-memory", async () => new InMemoryCustomerStore());

  sharedStoreTests("file", async () => {
    const filePath = await tempDbPath("rd-cust-file-");
    return new FileCustomerStore({ filePath });
  });

  it("keeps the in-memory store empty until a caller writes or seeds", async () => {
    const previous = process.env[SEED_DEMO_CUSTOMERS_ENV];
    process.env[SEED_DEMO_CUSTOMERS_ENV] = "1";
    try {
      const store = createInMemoryCustomerStore();
      expect(await store.listCustomers()).toEqual([]);
      const skipped = await seedDemoCustomers(store, { enabled: false });
      expect(skipped.skipped).toBe(true);
      expect(skipped.message).toMatch(/Demo customer seed did not run/);
      expect(await store.listCustomers()).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env[SEED_DEMO_CUSTOMERS_ENV];
      else process.env[SEED_DEMO_CUSTOMERS_ENV] = previous;
    }
  });

  it("does not create a data file until the first mutation", async () => {
    const filePath = await tempDbPath("rd-cust-empty-");
    const store = new FileCustomerStore({ filePath });
    expect(await store.listCustomers()).toEqual([]);
    await expect(stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reloads customers and requests from the LowDB file", async () => {
    const filePath = await tempDbPath("rd-cust-reload-");
    const first = new FileCustomerStore({ filePath });
    await first.upsertCustomer({ customerId: "cust_1042", name: "Acme" });
    await first.upsertRequest(requestInput("cust_1042", "creq_labels", "Rename labels"));

    const second = createFileCustomerStore({ filePath });
    expect(await second.getCustomer("cust_1042")).toMatchObject({ name: "Acme" });
    expect(await second.listRequests("cust_1042")).toHaveLength(1);
    const raw = await readFile(filePath, "utf8");
    expect(raw).toContain('"version": 1');
    expect(raw).toContain("cust_1042");
  });

  it("uses RELEASEDESK_CUSTOMER_DB_PATH and lets the constructor override it", async () => {
    const envPath = await tempDbPath("rd-cust-env-");
    const explicitPath = await tempDbPath("rd-cust-explicit-");
    const previous = process.env[CUSTOMER_DB_PATH_ENV];
    process.env[CUSTOMER_DB_PATH_ENV] = envPath;
    try {
      expect(resolveCustomerDbPath()).toBe(path.resolve(envPath));
      const fromEnv = new FileCustomerStore();
      expect(fromEnv.filePath).toBe(path.resolve(envPath));
      await fromEnv.upsertCustomer({ customerId: "cust_envpath", name: "Env Co" });

      const explicit = new FileCustomerStore({ filePath: explicitPath });
      expect(explicit.filePath).toBe(path.resolve(explicitPath));
      expect(await explicit.listCustomers()).toEqual([]);
      expect(await fromEnv.getCustomer("cust_envpath")).toMatchObject({ name: "Env Co" });
    } finally {
      if (previous === undefined) delete process.env[CUSTOMER_DB_PATH_ENV];
      else process.env[CUSTOMER_DB_PATH_ENV] = previous;
    }
  });

  it("defaults the data file under the gitignored core data directory", () => {
    const previous = process.env[CUSTOMER_DB_PATH_ENV];
    delete process.env[CUSTOMER_DB_PATH_ENV];
    try {
      expect(defaultCustomerDbPath()).toMatch(/packages\/releasedesk-core\/data\/customers\.json$/);
      expect(resolveCustomerDbPath()).toBe(defaultCustomerDbPath());
      expect(resolveCustomerDbPath("  ")).toBe(defaultCustomerDbPath());
    } finally {
      if (previous === undefined) delete process.env[CUSTOMER_DB_PATH_ENV];
      else process.env[CUSTOMER_DB_PATH_ENV] = previous;
    }
  });

  it("fails clearly when the document file is not a customer store", async () => {
    const filePath = await tempDbPath("rd-cust-bad-");
    await writeFile(filePath, "{not json", "utf8");
    const broken = new FileCustomerStore({ filePath });
    await expect(broken.listCustomers()).rejects.toThrow(/could not be read/);

    const invalidPath = await tempDbPath("rd-cust-invalid-");
    await writeFile(
      invalidPath,
      JSON.stringify({
        version: 1,
        customers: [{ customerId: "CUST-1042", name: "Nope" }],
        requests: [],
      }),
      "utf8",
    );
    const invalid = new FileCustomerStore({ filePath: invalidPath });
    await expect(invalid.listCustomers()).rejects.toThrow(/failed validation/);
  });

  it("fails clearly on duplicate customer ids in the file", async () => {
    const filePath = await tempDbPath("rd-cust-dup-");
    const at = new Date().toISOString();
    const row = {
      customerId: "cust_dup",
      name: "Dup",
      weight: 1,
      createdAt: at,
      updatedAt: at,
    };
    await writeFile(
      filePath,
      JSON.stringify({ version: 1, customers: [row, row], requests: [] }),
      "utf8",
    );
    const store = new FileCustomerStore({ filePath });
    await expect(store.getCustomer("cust_dup")).rejects.toThrow(/duplicate customerId cust_dup/);
  });
});

describe("demo customer seed", () => {
  it("targets Northwind Bank at its own customer repo", () => {
    const byId = new Map(DEMO_PORTFOLIO.map((app) => [app.customerId, app]));
    expect(byId.get("cust_northwind")).toMatchObject({
      repository: "vishamathur/northwind-bank-kyc-identity",
      baseRef: "main",
    });
    expect(byId.get("cust_contoso")?.repository).toBe("vishamathur/mvp-releasedesk");
    expect(byId.get("cust_fabrikam")?.repository).toBe("vishamathur/mvp-releasedesk");
    const northwind = demoCustomerInputs().find((row) => row.customerId === "cust_northwind");
    expect(northwind?.metadata?.repository).toBe("vishamathur/northwind-bank-kyc-identity");
  });

  it("seeds exactly the DEMO_PORTFOLIO customers when opted in", async () => {
    expect(DEMO_PORTFOLIO.map((app) => app.customerName).sort()).toEqual([
      "Contoso Retail",
      "Fabrikam Logistics",
      "Northwind Bank",
    ]);
    const store = createInMemoryCustomerStore();
    const previous = process.env[SEED_DEMO_CUSTOMERS_ENV];
    delete process.env[SEED_DEMO_CUSTOMERS_ENV];
    try {
      const skipped = await seedDemoCustomers(store);
      expect(skipped.skipped).toBe(true);
      expect(await store.listCustomers()).toEqual([]);

      process.env[SEED_DEMO_CUSTOMERS_ENV] = "1";
      const seeded = await seedDemoCustomers(store);
      expect(seeded.skipped).toBe(false);
      expect(seeded.message).toMatch(/^DEMO: seeded 3 demo customer/);
      expect(seeded.inserted).toHaveLength(3);
      for (const app of DEMO_PORTFOLIO) {
        const row = seeded.inserted.find((customer) => customer.customerId === app.customerId);
        expect(row?.name).toBe(app.customerName);
        expect(row?.metadata).toMatchObject({
          demo: true,
          source: "DEMO_PORTFOLIO",
          application: app.application,
          mock: { mocked: true, mockLabel: "demo-portfolio" },
        });
        const note = (row?.metadata?.mock as { note?: string } | undefined)?.note ?? "";
        expect(note).toMatch(/DEMO: seeded from DEMO_PORTFOLIO/);
      }

      const again = await seedDemoCustomers(store, { enabled: true });
      expect(again.inserted).toEqual([]);
      expect(again.alreadyPresent).toHaveLength(3);
      expect(again.message).toMatch(/DEMO: demo customer seed is idempotent/);
      const listed = await store.listCustomers();
      expect(listed).toHaveLength(3);
      for (const customer of listed) {
        const first = seeded.inserted.find((row) => row.customerId === customer.customerId);
        expect(customer.createdAt).toBe(first?.createdAt);
        expect(customer.updatedAt).toBe(first?.updatedAt);
      }
    } finally {
      if (previous === undefined) delete process.env[SEED_DEMO_CUSTOMERS_ENV];
      else process.env[SEED_DEMO_CUSTOMERS_ENV] = previous;
    }
  });

  it("does not overwrite a customer that is already stored", async () => {
    const store = createInMemoryCustomerStore();
    const created = await store.upsertCustomer({
      customerId: "cust_northwind",
      name: "Real Northwind",
      metadata: { demo: false },
    });
    const seeded = await seedDemoCustomers(store, { enabled: true });
    expect(seeded.inserted.map((customer) => customer.customerId).sort()).toEqual([
      "cust_contoso",
      "cust_fabrikam",
    ]);
    const northwind = await store.getCustomer("cust_northwind");
    expect(northwind).toMatchObject({
      name: "Real Northwind",
      createdAt: created.createdAt,
      metadata: { demo: false },
    });
  });

  it("writes demo customers only through the explicit seed, including on a file store", async () => {
    const filePath = await tempDbPath("rd-cust-seed-");
    const previousSeed = process.env[SEED_DEMO_CUSTOMERS_ENV];
    process.env[SEED_DEMO_CUSTOMERS_ENV] = "1";
    try {
      const opened = new FileCustomerStore({ filePath });
      expect(await opened.listCustomers()).toEqual([]);
      await expect(stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });

      const seeded = await seedDemoCustomers(opened);
      expect(seeded.message).toMatch(/DEMO: seeded 3 demo customer/);
      const reopened = new FileCustomerStore({ filePath });
      expect((await reopened.listCustomers()).map((customer) => customer.customerId).sort()).toEqual(
        DEMO_PORTFOLIO.map((app) => app.customerId).sort(),
      );
    } finally {
      if (previousSeed === undefined) delete process.env[SEED_DEMO_CUSTOMERS_ENV];
      else process.env[SEED_DEMO_CUSTOMERS_ENV] = previousSeed;
    }
  });
});

describe("seed-demo-customers script", () => {
  const script = fileURLToPath(new URL("./seed-demo-customers.ts", import.meta.url));
  const tsxCli = path.join(path.dirname(require.resolve("tsx/package.json")), "dist/cli.mjs");

  async function runScript(env: NodeJS.ProcessEnv, args: string[] = []) {
    return execFileAsync(process.execPath, [tsxCli, script, ...args], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env,
      encoding: "utf8",
    });
  }

  it("refuses to write unless the demo flag is set", async () => {
    const env = { ...process.env };
    delete env[SEED_DEMO_CUSTOMERS_ENV];
    await expect(runScript(env)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/DEMO customer seed refused/),
    });
  });

  it("seeds the temp file when --demo is passed and is idempotent", async () => {
    const filePath = await tempDbPath("rd-cust-script-");
    const env = { ...process.env, [CUSTOMER_DB_PATH_ENV]: filePath };
    delete env[SEED_DEMO_CUSTOMERS_ENV];
    const first = await runScript(env, ["--demo"]);
    expect(first.stdout).toMatch(/DEMO: seeded 3 demo customer/);
    expect(first.stdout).toMatch(/DEMO inserted cust_northwind Northwind Bank/);
    const second = await runScript(env, ["--demo"]);
    expect(second.stdout).toMatch(/DEMO: demo customer seed is idempotent/);
    expect(second.stdout).toMatch(/DEMO already present cust_fabrikam Fabrikam Logistics/);
    const store = new FileCustomerStore({ filePath });
    expect(await store.listCustomers()).toHaveLength(3);
  });
});
