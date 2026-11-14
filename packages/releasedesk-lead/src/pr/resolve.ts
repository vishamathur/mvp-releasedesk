import { createMockPrClient, type MockPrClientOptions } from "./mock-client.js";
import { createRealPrClient, type RealPrClientOptions } from "./real-client.js";
import type { PrClientMode, PrWorkflowClient } from "./types.js";

export type ResolvePrClientOptions = {
  /** Force mode; default resolves from env. */
  mode?: PrClientMode | "auto";
  token?: string;
  mock?: MockPrClientOptions;
  real?: Omit<RealPrClientOptions, "token"> & { token?: string };
  /** Inject a pre-built client (tests). */
  client?: PrWorkflowClient;
};

export function resolveGithubToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = env.GH_TOKEN ?? env.GITHUB_TOKEN;
  return token && token.trim() ? token.trim() : undefined;
}

/**
 * Resolve PR workflow client:
 * - Injected `client` wins
 * - `mode: "mock"` → MOCK
 * - `mode: "real"` → real (requires token)
 * - auto (default): real when GH_TOKEN/GITHUB_TOKEN present, else MOCK
 */
export function resolvePrClient(options: ResolvePrClientOptions = {}): PrWorkflowClient {
  if (options.client) return options.client;

  const mode = options.mode ?? "auto";
  const token = options.token ?? options.real?.token ?? resolveGithubToken();

  if (mode === "mock") {
    return createMockPrClient(options.mock);
  }

  if (mode === "real") {
    if (!token) {
      throw new Error(
        "Real GitHub PR client requested but GH_TOKEN/GITHUB_TOKEN is not set",
      );
    }
    return createRealPrClient({
      token,
      ...(options.real?.fetchImpl ? { fetchImpl: options.real.fetchImpl } : {}),
      ...(options.real?.apiBase ? { apiBase: options.real.apiBase } : {}),
    });
  }

  // auto
  if (token) {
    return createRealPrClient({
      token,
      ...(options.real?.fetchImpl ? { fetchImpl: options.real.fetchImpl } : {}),
      ...(options.real?.apiBase ? { apiBase: options.real.apiBase } : {}),
    });
  }
  return createMockPrClient(options.mock);
}

export function describePrClientMode(client: PrWorkflowClient): string {
  if (client.mode === "mock") {
    return "MOCK: GitHub PR client (no GH_TOKEN/GITHUB_TOKEN)";
  }
  return "Real GitHub PR client (token present)";
}
