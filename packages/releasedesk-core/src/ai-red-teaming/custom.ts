import { MissingCredentialError } from "../config-error.js";
import type {
  AiRedTeamFramework,
  AiRedTeamHealthCheck,
  AiRedTeamProbeResult,
  AiRedTeamProbeTarget,
  AiRedTeamingProvider,
} from "./types.js";

/**
 * Custom AI Red Teaming provider.
 * A live probe engine is not attached. Calls throw instead of returning sample findings.
 */
export function createCustomAiRedTeamingProvider(): AiRedTeamingProvider {
  return {
    name: "custom",

    async healthCheck(): Promise<AiRedTeamHealthCheck> {
      throw new MissingCredentialError("custom AI red-team probe engine");
    },

    async runProbes(
      _target: AiRedTeamProbeTarget,
      _frameworks: readonly AiRedTeamFramework[],
    ): Promise<AiRedTeamProbeResult> {
      throw new MissingCredentialError("custom AI red-team probe engine");
    },
  };
}
