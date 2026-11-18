import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ComponentRef } from "./advisories.js";

type PkgJson = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/**
 * Discover npm components from local package.json files when Lead passes an empty list.
 */
export async function discoverNpmComponents(workspaceRoot: string): Promise<ComponentRef[]> {
  const targets = [
    path.join(workspaceRoot, "package.json"),
    path.join(workspaceRoot, "apps", "kyc", "package.json"),
    path.join(workspaceRoot, "packages", "releasedesk-core", "package.json"),
    path.join(workspaceRoot, "packages", "releasedesk-lead", "package.json"),
    path.join(workspaceRoot, "packages", "releasedesk-specialists", "package.json"),
  ];

  const byName = new Map<string, ComponentRef>();

  for (const file of targets) {
    try {
      const raw = await readFile(file, "utf8");
      const pkg = JSON.parse(raw) as PkgJson;
      const add = (name: string, version?: string) => {
        const key = name.toLowerCase();
        if (!byName.has(key)) {
          byName.set(key, {
            name,
            ...(version !== undefined ? { version: stripRange(version) } : {}),
            ecosystem: "npm",
          });
        }
      };
      if (pkg.name) add(pkg.name, pkg.version);
      for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
        add(name, version);
      }
      for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
        add(name, version);
      }
    } catch {
      // Missing package.json is fine — skip.
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function stripRange(version: string): string {
  return version.replace(/^[\^~>=<\s]+/, "").trim();
}
