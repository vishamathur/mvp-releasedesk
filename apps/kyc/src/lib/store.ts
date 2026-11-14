import { promises as fs } from "node:fs";
import path from "node:path";
import type { KycApplication } from "./domain/types";

export interface StoreData {
  applications: KycApplication[];
  seededAt: string | null;
}

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

const emptyStore = (): StoreData => ({
  applications: [],
  seededAt: null,
});

async function ensureStore(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch {
    await fs.writeFile(STORE_PATH, JSON.stringify(emptyStore(), null, 2), "utf8");
  }
}

export async function readStore(): Promise<StoreData> {
  await ensureStore();
  const raw = await fs.readFile(STORE_PATH, "utf8");
  try {
    const parsed = JSON.parse(raw) as StoreData;
    return {
      applications: parsed.applications ?? [],
      seededAt: parsed.seededAt ?? null,
    };
  } catch {
    return emptyStore();
  }
}

export async function writeStore(data: StoreData): Promise<void> {
  await ensureStore();
  await fs.writeFile(STORE_PATH, JSON.stringify(data, null, 2), "utf8");
}

export async function listApplications(): Promise<KycApplication[]> {
  const store = await readStore();
  return [...store.applications].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export async function getApplication(id: string): Promise<KycApplication | null> {
  const store = await readStore();
  return store.applications.find((a) => a.id === id) ?? null;
}

export async function saveApplication(app: KycApplication): Promise<KycApplication> {
  const store = await readStore();
  const idx = store.applications.findIndex((a) => a.id === app.id);
  if (idx >= 0) {
    store.applications[idx] = app;
  } else {
    store.applications.push(app);
  }
  await writeStore(store);
  return app;
}

export async function replaceAllApplications(
  applications: KycApplication[],
  seededAt: string,
): Promise<StoreData> {
  const next: StoreData = { applications, seededAt };
  await writeStore(next);
  return next;
}
