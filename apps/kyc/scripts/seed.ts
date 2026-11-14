import { seedStore } from "../src/lib/seed";

async function main() {
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
