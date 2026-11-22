import { MissingCredentialError } from "@releasedesk/core";
import { createRealPrClient, type RealPrClientOptions } from "./real-client.js";
import type { PrWorkflowClient } from "./types.js";

export type ResolvePrClientOptions = {
  token?: string;
  real?: Omit<RealPrClientOptions, "token"> & { token?: string };
  /** Inject a pre-built client. */
  client?: PrWorkflowClient;
};

export function resolveGithubToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = env.GH_TOKEN ?? env.GITHUB_TOKEN;
  return token && token.trim() ? token.trim() : undefined;
}

/**
 * Real GitHub PR client only. Missing GH_TOKEN/GITHUB_TOKEN throws.
 */
export function resolvePrClient(options: ResolvePrClientOptions = {}): PrWorkflowClient {
  if (options.client) return options.client;

  const token = options.token ?? options.real?.token ?? resolveGithubToken();
  if (!token) {
    throw new MissingCredentialError("GH_TOKEN");
  }
  return createRealPrClient({
    token,
    ...(options.real?.fetchImpl ? { fetchImpl: options.real.fetchImpl } : {}),
    ...(options.real?.apiBase ? { apiBase: options.real.apiBase } : {}),
  });
}

export function describePrClientMode(_client: PrWorkflowClient): string {
  return "Real GitHub PR client (GH_TOKEN or GITHUB_TOKEN)";
}
