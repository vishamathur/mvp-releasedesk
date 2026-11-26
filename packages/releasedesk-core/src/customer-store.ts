import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { z } from "zod";
import { nowIso } from "./ids.js";
import {
  createCustomerId,
  createCustomerRequestId,
  CustomerIdSchema,
  CustomerRequestIdSchema,
  CustomerRequestSchema,
  CustomerSchema,
  type CreateCustomerRequestInput,
  type Customer,
  type CustomerRequest,
  type UpsertCustomerInput,
} from "./intake.js";
import { createMockMeta } from "./mock.js";
import { DEMO_PORTFOLIO } from "./portfolio.js";

/**
 * Persistent customers and customer requests.
 *
 * FileCustomerStore uses LowDB: an in-process JSON document file, no server.
 * Opening a store does not seed. Call seedDemoCustomers to opt in.
 */

export const CUSTOMER_DB_PATH_ENV = "RELEASEDESK_CUSTOMER_DB_PATH";
export const SEED_DEMO_CUSTOMERS_ENV = "RELEASEDESK_SEED_DEMO_CUSTOMERS";

const DEMO_SEED_NOTE =
  "DEMO: seeded from DEMO_PORTFOLIO; not a production customer";

const CustomerDbFileSchema = z.object({
  version: z.literal(1),
  customers: z.array(CustomerSchema),
  requests: z.array(CustomerRequestSchema),
});

type CustomerDbFile = z.infer<typeof CustomerDbFileSchema>;

export type CustomerStore = {
  upsertCustomer(input: UpsertCustomerInput): Promise<Customer>;
  getCustomer(customerId: string): Promise<Customer | undefined>;
  listCustomers(): Promise<Customer[]>;
  upsertRequest(input: CreateCustomerRequestInput): Promise<CustomerRequest>;
  getRequest(requestId: string): Promise<CustomerRequest | undefined>;
  listRequests(customerId: string): Promise<CustomerRequest[]>;
};

export type FileCustomerStoreOptions = {
  /** Absolute or relative data file. Overrides RELEASEDESK_CUSTOMER_DB_PATH. */
  filePath?: string;
};

export type SeedDemoCustomersOptions = {
  /**
   * When set, this flag wins over RELEASEDESK_SEED_DEMO_CUSTOMERS.
   * Omit it to follow the env var. The default is off.
   */
  enabled?: boolean;
};

export type SeedDemoCustomersResult = {
  skipped: boolean;
  inserted: Customer[];
  alreadyPresent: Customer[];
  message: string;
};

function emptyCustomerDb(): CustomerDbFile {
  return { version: 1, customers: [], requests: [] };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sortCustomers(customers: readonly Customer[]): Customer[] {
  return [...customers]
    .sort((a, b) => a.customerId.localeCompare(b.customerId))
    .map((customer) => clone(customer));
}

function sortRequests(requests: readonly CustomerRequest[]): CustomerRequest[] {
  return [...requests]
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )
    .map((request) => clone(request));
}

export function defaultCustomerDbPath(): string {
  return fileURLToPath(new URL("../data/customers.json", import.meta.url));
}

/** Constructor path, then RELEASEDESK_CUSTOMER_DB_PATH, then the gitignored default. */
export function resolveCustomerDbPath(filePath?: string): string {
  const explicit = filePath?.trim();
  if (explicit) return path.resolve(explicit);
  const fromEnv = process.env[CUSTOMER_DB_PATH_ENV]?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return defaultCustomerDbPath();
}

export function demoSeedEnabled(enabled?: boolean): boolean {
  if (enabled !== undefined) return enabled;
  return process.env[SEED_DEMO_CUSTOMERS_ENV] === "1";
}

/** Demo rows drawn from DEMO_PORTFOLIO. Nothing else is invented. */
export function demoCustomerInputs(): UpsertCustomerInput[] {
  return DEMO_PORTFOLIO.map((app) => ({
    customerId: app.customerId,
    name: app.customerName,
    weight: 1,
    metadata: {
      demo: true,
      source: "DEMO_PORTFOLIO",
      application: app.application,
      repository: app.repository,
      mock: createMockMeta("demo-portfolio", DEMO_SEED_NOTE),
    },
  }));
}

export function nextCustomerRecord(
  existing: Customer | undefined,
  input: UpsertCustomerInput,
): Customer {
  const customerId = input.customerId
    ? CustomerIdSchema.parse(input.customerId)
    : (existing?.customerId ?? createCustomerId(input.name));
  const at = nowIso();
  return CustomerSchema.parse({
    customerId,
    name: input.name,
    weight: input.weight ?? existing?.weight ?? 1,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    ...(input.metadata !== undefined
      ? { metadata: input.metadata }
      : existing?.metadata !== undefined
        ? { metadata: existing.metadata }
        : {}),
  });
}

export function nextRequestRecord(
  existing: CustomerRequest | undefined,
  input: CreateCustomerRequestInput,
): CustomerRequest {
  const customerId = CustomerIdSchema.parse(input.customerId);
  if (existing && existing.customerId !== customerId) {
    throw new Error(
      `Customer request ${existing.id} customerId ${existing.customerId} does not match ${customerId}`,
    );
  }
  const at = nowIso();
  return CustomerRequestSchema.parse({
    id: input.id ?? existing?.id ?? createCustomerRequestId(),
    customerId,
    title: input.title,
    summary: input.summary,
    requestedBy: input.requestedBy,
    ...(input.priorityHint !== undefined
      ? { priorityHint: input.priorityHint }
      : existing?.priorityHint !== undefined
        ? { priorityHint: existing.priorityHint }
        : {}),
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    ...(input.metadata !== undefined
      ? { metadata: input.metadata }
      : existing?.metadata !== undefined
        ? { metadata: existing.metadata }
        : {}),
  });
}

function assertUniqueDocuments(file: CustomerDbFile, filePath: string): void {
  const customerIds = new Set<string>();
  for (const customer of file.customers) {
    if (customerIds.has(customer.customerId)) {
      throw new Error(
        `Customer store at ${filePath} has duplicate customerId ${customer.customerId}`,
      );
    }
    customerIds.add(customer.customerId);
  }
  const requestIds = new Set<string>();
  for (const request of file.requests) {
    if (requestIds.has(request.id)) {
      throw new Error(
        `Customer store at ${filePath} has duplicate request id ${request.id}`,
      );
    }
    requestIds.add(request.id);
  }
}

export class InMemoryCustomerStore implements CustomerStore {
  private readonly customers = new Map<string, Customer>();
  private readonly requests = new Map<string, CustomerRequest>();

  async upsertCustomer(input: UpsertCustomerInput): Promise<Customer> {
    const previewId = input.customerId
      ? CustomerIdSchema.parse(input.customerId)
      : undefined;
    const existing = previewId ? this.customers.get(previewId) : undefined;
    const stored = clone(nextCustomerRecord(existing, input));
    this.customers.set(stored.customerId, stored);
    return clone(stored);
  }

  async getCustomer(customerId: string): Promise<Customer | undefined> {
    const id = CustomerIdSchema.parse(customerId);
    const found = this.customers.get(id);
    return found ? clone(found) : undefined;
  }

  async listCustomers(): Promise<Customer[]> {
    return sortCustomers([...this.customers.values()]);
  }

  async upsertRequest(input: CreateCustomerRequestInput): Promise<CustomerRequest> {
    const customerId = CustomerIdSchema.parse(input.customerId);
    if (!this.customers.has(customerId)) {
      throw new Error(`Unknown customerId ${customerId}; upsert customer first`);
    }
    const existing = input.id ? this.requests.get(input.id) : undefined;
    const stored = clone(nextRequestRecord(existing, input));
    this.requests.set(stored.id, stored);
    return clone(stored);
  }

  async getRequest(requestId: string): Promise<CustomerRequest | undefined> {
    const id = CustomerRequestIdSchema.parse(requestId);
    const found = this.requests.get(id);
    return found ? clone(found) : undefined;
  }

  async listRequests(customerId: string): Promise<CustomerRequest[]> {
    const id = CustomerIdSchema.parse(customerId);
    return sortRequests(
      [...this.requests.values()].filter((request) => request.customerId === id),
    );
  }
}

export class FileCustomerStore implements CustomerStore {
  readonly filePath: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: FileCustomerStoreOptions = {}) {
    this.filePath = resolveCustomerDbPath(options.filePath);
  }

  private run<T>(fn: (db: Low<CustomerDbFile>) => Promise<T>): Promise<T> {
    const task = this.queue.then(async () => {
      const db = new Low<CustomerDbFile>(
        new JSONFile<CustomerDbFile>(this.filePath),
        emptyCustomerDb(),
      );
      try {
        await db.read();
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Customer store at ${this.filePath} could not be read: ${reason}`,
        );
      }
      const parsed = CustomerDbFileSchema.safeParse(db.data);
      if (!parsed.success) {
        throw new Error(
          `Customer store at ${this.filePath} failed validation: ${parsed.error.message}`,
        );
      }
      assertUniqueDocuments(parsed.data, this.filePath);
      db.data = parsed.data;
      return fn(db);
    });
    this.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async persist(db: Low<CustomerDbFile>): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await db.write();
  }

  async upsertCustomer(input: UpsertCustomerInput): Promise<Customer> {
    return this.run(async (db) => {
      const previewId = input.customerId
        ? CustomerIdSchema.parse(input.customerId)
        : undefined;
      const existing = previewId
        ? db.data.customers.find((customer) => customer.customerId === previewId)
        : undefined;
      const stored = clone(nextCustomerRecord(existing, input));
      const index = db.data.customers.findIndex(
        (customer) => customer.customerId === stored.customerId,
      );
      if (index >= 0) db.data.customers[index] = stored;
      else db.data.customers.push(stored);
      await this.persist(db);
      return clone(stored);
    });
  }

  async getCustomer(customerId: string): Promise<Customer | undefined> {
    const id = CustomerIdSchema.parse(customerId);
    return this.run(async (db) => {
      const found = db.data.customers.find((customer) => customer.customerId === id);
      return found ? clone(found) : undefined;
    });
  }

  async listCustomers(): Promise<Customer[]> {
    return this.run(async (db) => sortCustomers(db.data.customers));
  }

  async upsertRequest(input: CreateCustomerRequestInput): Promise<CustomerRequest> {
    return this.run(async (db) => {
      const customerId = CustomerIdSchema.parse(input.customerId);
      const customer = db.data.customers.find(
        (row) => row.customerId === customerId,
      );
      if (!customer) {
        throw new Error(`Unknown customerId ${customerId}; upsert customer first`);
      }
      const existing = input.id
        ? db.data.requests.find((request) => request.id === input.id)
        : undefined;
      const stored = clone(nextRequestRecord(existing, input));
      const index = db.data.requests.findIndex((request) => request.id === stored.id);
      if (index >= 0) db.data.requests[index] = stored;
      else db.data.requests.push(stored);
      await this.persist(db);
      return clone(stored);
    });
  }

  async getRequest(requestId: string): Promise<CustomerRequest | undefined> {
    const id = CustomerRequestIdSchema.parse(requestId);
    return this.run(async (db) => {
      const found = db.data.requests.find((request) => request.id === id);
      return found ? clone(found) : undefined;
    });
  }

  async listRequests(customerId: string): Promise<CustomerRequest[]> {
    const id = CustomerIdSchema.parse(customerId);
    return this.run(async (db) =>
      sortRequests(db.data.requests.filter((request) => request.customerId === id)),
    );
  }
}

export function createInMemoryCustomerStore(): InMemoryCustomerStore {
  return new InMemoryCustomerStore();
}

export function createFileCustomerStore(
  options?: FileCustomerStoreOptions,
): FileCustomerStore {
  return new FileCustomerStore(options);
}

/**
 * Opt-in demo seed. Inserts the DEMO_PORTFOLIO customers when they are missing.
 * A second call leaves existing rows, including createdAt, unchanged.
 * Passing enabled:false, or leaving the env unset, writes nothing.
 */
export async function seedDemoCustomers(
  store: CustomerStore,
  options: SeedDemoCustomersOptions = {},
): Promise<SeedDemoCustomersResult> {
  if (!demoSeedEnabled(options.enabled)) {
    return {
      skipped: true,
      inserted: [],
      alreadyPresent: [],
      message:
        "Demo customer seed did not run. It is opt-in: set RELEASEDESK_SEED_DEMO_CUSTOMERS=1 or call seedDemoCustomers(store, { enabled: true }). The store stays empty.",
    };
  }

  const inserted: Customer[] = [];
  const alreadyPresent: Customer[] = [];
  for (const input of demoCustomerInputs()) {
    const customerId = CustomerIdSchema.parse(input.customerId);
    const existing = await store.getCustomer(customerId);
    if (existing) {
      alreadyPresent.push(existing);
      continue;
    }
    inserted.push(await store.upsertCustomer(input));
  }

  const described = inserted
    .map((customer) => `${customer.customerId} (${customer.name})`)
    .join(", ");
  const message =
    inserted.length > 0
      ? `DEMO: seeded ${inserted.length} demo customer(s) from DEMO_PORTFOLIO: ${described}. metadata.demo=true. Not production data.`
      : `DEMO: demo customer seed is idempotent; ${alreadyPresent.length} DEMO_PORTFOLIO customer(s) already present and were left unchanged. Not production data.`;

  return { skipped: false, inserted, alreadyPresent, message };
}
