import { createMockMeta, formatMockNote } from "@releasedesk/core";
import type {
  CloudAgentClient,
  CloudAgentDispatchRequest,
  CloudAgentDispatchResult,
  CloudAgentKind,
} from "./types.js";

/**
 * Deprecated Cursor Cloud Agents API client.
 * Desk no longer selects it. Builder launches the agent from the Grok Bot app.
 * Do not set RELEASEDESK_CLOUD_CLIENT=real.
 *
 * Docs: https://cursor.com/docs/cloud-agent/api/endpoints
 */

export type RealCloudAgentClientOptions = {
  /**
   * Single exclusive key override (tests). When set, used for every kind.
   * Prefer {@link resolveApiKeyForKind} in production so each agent has its own key.
   */
  apiKey?: string;
  /** Per-kind exclusive key resolver (Coding / Testing / Review). */
  resolveApiKeyForKind?: (kind: CloudAgentKind) => string | undefined;
  /** Default https://api.cursor.com */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Poll interval while waiting for run terminal status (ms). */
  pollIntervalMs?: number;
  /** Max poll duration (ms). */
  pollTimeoutMs?: number;
  /** Optional model id for create agent. */
  modelId?: string;
};

type ApiGitBranch = {
  repoUrl?: string;
  branch?: string;
  prUrl?: string;
};

type ApiRun = {
  id: string;
  agentId?: string;
  status: string;
  result?: { text?: string };
  git?: { branches?: ApiGitBranch[] };
};

type ApiCreateResponse = {
  agent?: { id: string; url?: string; status?: string };
  run?: ApiRun;
};

/**
 * @deprecated Shared CURSOR_* keys are not used on the SDLC path.
 * Prefer resolveCursorApiKeyForAgent from resolve.ts / @releasedesk/core.
 */
export function resolveCursorApiKey(_env: NodeJS.ProcessEnv = process.env): string | undefined {
  return undefined;
}

function repoHttpsUrl(repository: string): string {
  if (repository.startsWith("http://") || repository.startsWith("https://")) {
    return repository;
  }
  return `https://github.com/${repository}`;
}

function sleep(ms: number, fetchImpl: typeof fetch): Promise<void> {
  // Prefer timers; fetchImpl unused but keeps signature injectable for tests that stub time.
  void fetchImpl;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

/**
 * Create a live Cursor Cloud Agents client.
 * Requires either `apiKey` (tests) or `resolveApiKeyForKind` (per-agent exclusive keys).
 * Network/API failures return failed results so Builder retry logic can handle them.
 */
export function createRealCloudAgentClient(
  options: RealCloudAgentClientOptions = {},
): CloudAgentClient {
  if (!options.apiKey && !options.resolveApiKeyForKind) {
    throw new Error(
      "createRealCloudAgentClient requires apiKey or resolveApiKeyForKind (exclusive RELEASEDESK_CURSOR_API_KEY_*)",
    );
  }

  const baseUrl = (options.baseUrl ?? "https://api.cursor.com").replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const pollTimeoutMs = options.pollTimeoutMs ?? 15 * 60 * 1000;

  function apiKeyFor(kind: CloudAgentKind): string | undefined {
    return options.apiKey ?? options.resolveApiKeyForKind?.(kind);
  }

  async function createAndWait(
    request: CloudAgentDispatchRequest,
    attempt: number,
    apiKey: string,
  ): Promise<CloudAgentDispatchResult> {
    const startingRef =
      request.agentKind === "coding"
        ? request.baseBranch
        : (request.branch ?? request.proposedBranch);

    const promptParts = [
      request.prompt,
      "",
      "Acceptance criteria:",
      ...request.acceptanceCriteria.map((c) => `- ${c}`),
      "",
      "IMPORTANT: Do NOT merge any pull request. Human approval is required (Release Desk gate).",
    ];

    if (request.agentKind === "coding") {
      promptParts.push(
        `Create/use branch ${request.proposedBranch} from ${request.baseBranch}.`,
        "Open a PR when done; leave it unmerged.",
      );
    }
    if (request.agentKind === "testing") {
      promptParts.push(
        `Independently verify branch ${startingRef}.`,
        "Run the repository test suite and report pass/fail clearly.",
      );
    }
    if (request.agentKind === "review") {
      promptParts.push(
        `Independently review the remediation${request.prUrl ? ` PR ${request.prUrl}` : ""}.`,
        "Record findings; do not approve merge.",
      );
    }

    const body: Record<string, unknown> = {
      prompt: { text: promptParts.join("\n") },
      name: `RD ${request.agentKind} ${request.handoffId}`.slice(0, 100),
      repos: [
        {
          url: repoHttpsUrl(request.repository),
          startingRef,
          ...(request.prUrl && request.agentKind !== "coding"
            ? { prUrl: request.prUrl }
            : {}),
        },
      ],
      // Coding may open a PR; never merge.
      autoCreatePR: request.agentKind === "coding",
      skipReviewerRequest: true,
    };
    if (options.modelId) {
      body.model = { id: options.modelId };
    }

    const createRes = await fetchImpl(`${baseUrl}/v1/agents`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify(body),
    });

    if (!createRes.ok) {
      const text = await createRes.text().catch(() => "");
      return {
        handoffId: request.handoffId,
        agentKind: request.agentKind,
        status: "failed",
        mocked: false,
        summary: `Cursor Cloud Agent create failed HTTP ${createRes.status}`,
        attempt,
        error: `HTTP ${createRes.status}: ${text.slice(0, 500)}`,
      };
    }

    const created = (await createRes.json()) as ApiCreateResponse;
    const agentId = created.agent?.id;
    const runId = created.run?.id;
    if (!agentId || !runId) {
      return {
        handoffId: request.handoffId,
        agentKind: request.agentKind,
        status: "failed",
        mocked: false,
        summary: "Cursor Cloud Agent create response missing agent/run id",
        attempt,
        error: "missing agent.id or run.id",
        provider: created as Record<string, unknown>,
      };
    }

    const cloudAgentUrl =
      created.agent?.url ?? `https://cursor.com/agents/${agentId}`;

    const terminal = await pollRun(agentId, runId, apiKey);
    const branches = terminal.git?.branches ?? [];
    const primary = branches[0];
    const branch = primary?.branch ?? request.branch ?? request.proposedBranch;
    const prUrl = primary?.prUrl ?? request.prUrl;

    if (terminal.status !== "FINISHED") {
      return {
        handoffId: request.handoffId,
        agentKind: request.agentKind,
        status: "failed",
        mocked: false,
        cloudAgentId: agentId,
        cloudRunId: runId,
        cloudAgentUrl,
        branch,
        prUrl,
        summary: `Cursor Cloud Agent run ended with status ${terminal.status}`,
        attempt,
        error: `run status ${terminal.status}`,
        provider: { runStatus: terminal.status, git: terminal.git },
      };
    }

    const resultText = terminal.result?.text ?? "";
    let testsPassed: boolean | undefined;
    if (request.agentKind === "testing") {
      const lower = resultText.toLowerCase();
      if (/\b(all tests? passed|tests? passed|npm test.*pass)\b/.test(lower)) {
        testsPassed = true;
      } else if (/\b(tests? failed|failing|npm test.*fail)\b/.test(lower)) {
        testsPassed = false;
      } else {
        // Conservative: finished testing run without clear failure → treat as passed.
        testsPassed = !/\bfail(ed|ure)?\b/.test(lower);
      }
    }

    return {
      handoffId: request.handoffId,
      agentKind: request.agentKind,
      status: "completed",
      mocked: false,
      cloudAgentId: agentId,
      cloudRunId: runId,
      cloudAgentUrl,
      branch,
      prUrl,
      testsPassed,
      summary:
        resultText.slice(0, 2000) ||
        `${request.agentKind} Cloud Agent finished on ${branch}`,
      attempt,
      provider: {
        runStatus: terminal.status,
        git: terminal.git,
        autoMerge: false,
      },
    };
  }

  async function pollRun(agentId: string, runId: string, apiKey: string): Promise<ApiRun> {
    const deadline = Date.now() + pollTimeoutMs;
    let last: ApiRun = { id: runId, status: "CREATING" };

    while (Date.now() < deadline) {
      const res = await fetchImpl(`${baseUrl}/v1/agents/${agentId}/runs/${runId}`, {
        headers: authHeaders(apiKey),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`poll HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      last = (await res.json()) as ApiRun;
      const status = last.status;
      if (
        status === "FINISHED" ||
        status === "ERROR" ||
        status === "CANCELLED" ||
        status === "EXPIRED"
      ) {
        return last;
      }
      await sleep(pollIntervalMs, fetchImpl);
    }

    return { ...last, status: last.status === "FINISHED" ? "FINISHED" : "EXPIRED" };
  }

  const attempts = new Map<string, number>();

  return {
    mode: "real",
    async dispatch(request: CloudAgentDispatchRequest): Promise<CloudAgentDispatchResult> {
      if (request.autoMerge !== false) {
        throw new Error("Release Desk Cloud Agents must not auto-merge");
      }

      const key = `${request.handoffId}:${request.agentKind}`;
      const attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);

      const apiKey = apiKeyFor(request.agentKind);
      if (!apiKey) {
        const expected =
          request.agentKind === "coding"
            ? "RELEASEDESK_CURSOR_API_KEY_CODING"
            : request.agentKind === "testing"
              ? "RELEASEDESK_CURSOR_API_KEY_TESTING"
              : "RELEASEDESK_CURSOR_API_KEY_REVIEW";
        const mock = createMockMeta(
          "cursor-cloud-agents",
          `Exclusive ${expected} missing for ${request.agentKind} (shared CURSOR_* never used)`,
        );
        return {
          handoffId: request.handoffId,
          agentKind: request.agentKind,
          status: "failed",
          mocked: true,
          mock,
          summary: formatMockNote(
            `Cannot dispatch ${request.agentKind} Cloud Agent — ${expected} unavailable`,
          ),
          attempt,
          error: `missing ${expected}`,
        };
      }

      try {
        return await createAndWait(request, attempt, apiKey);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          handoffId: request.handoffId,
          agentKind: request.agentKind,
          status: "failed",
          mocked: false,
          summary: `Cursor Cloud Agent dispatch error: ${message}`,
          attempt,
          error: message,
        };
      }
    },
  };
}

/**
 * Real-client stub factory that falls back to an explicit error result when
 * credentials are missing — used by resolveCloudAgentClient when mode=real
 * was requested without a key (should not happen if resolve is correct).
 */
export function createUnavailableRealClientStub(
  expectedEnvVar = "RELEASEDESK_CURSOR_API_KEY_CODING",
): CloudAgentClient {
  return {
    mode: "real",
    async dispatch(request): Promise<CloudAgentDispatchResult> {
      const mock = createMockMeta(
        "cursor-cloud-agents",
        `Real client requested but exclusive ${expectedEnvVar} missing (shared CURSOR_* never used)`,
      );
      return {
        handoffId: request.handoffId,
        agentKind: request.agentKind,
        status: "failed",
        mocked: true,
        mock,
        summary: formatMockNote(
          `Cannot dispatch real Cloud Agent — ${expectedEnvVar} unavailable`,
        ),
        attempt: 1,
        error: `missing ${expectedEnvVar}`,
      };
    },
  };
}
