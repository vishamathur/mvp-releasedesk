import { pathToFileURL } from "node:url";
import {
  FileCustomerStore,
  SEED_DEMO_CUSTOMERS_ENV,
  seedDemoCustomers,
} from "./customer-store.js";

/**
 * DEMO-only customer seed. Refuses to run unless
 * RELEASEDESK_SEED_DEMO_CUSTOMERS=1 or --demo is passed.
 * The file store does not call this on open.
 */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

async function main(): Promise<void> {
  const optedIn =
    process.argv.includes("--demo") || process.env[SEED_DEMO_CUSTOMERS_ENV] === "1";
  if (!optedIn) {
    console.error(
      "DEMO customer seed refused. This step is opt-in and does not run when the store opens. Set RELEASEDESK_SEED_DEMO_CUSTOMERS=1 or pass --demo.",
    );
    process.exitCode = 1;
    return;
  }

  const store = new FileCustomerStore();
  const result = await seedDemoCustomers(store, { enabled: true });
  console.log(result.message);
  for (const customer of result.inserted) {
    console.log(`DEMO inserted ${customer.customerId} ${customer.name}`);
  }
  for (const customer of result.alreadyPresent) {
    console.log(`DEMO already present ${customer.customerId} ${customer.name}`);
  }
}

if (isDirectRun()) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exitCode = 1;
  });
}
