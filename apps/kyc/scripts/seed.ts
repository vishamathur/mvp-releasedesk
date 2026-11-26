import { readFileSync } from "node:fs";
import { seedStore } from "../src/lib/seed";

/** Load apps/kyc/.env.local without printing values. Existing env wins. */
function loadEnvLocal(): void {
  try {
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // Missing file: seedStore fails closed when KYC_DATA_KEY is unset.
  }
}

async function main() {
  loadEnvLocal();
  const store = await seedStore();
  console.log(
    `Seeded ${store.applications.length} KYC applications at ${store.seededAt}`,
  );
  for (const app of store.applications) {
    console.log(`- ${app.reference} (${app.status}) ${app.identity?.firstName} ${app.identity?.lastName}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
