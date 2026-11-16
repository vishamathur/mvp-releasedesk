import {
  CURSOR_API_KEY_ENV,
  createMockMeta,
  formatMockNote,
  resolveAgentCursorApiKey,
  type CursorKeyedAgentId,
} from "@releasedesk/core";
import type {
  CloudAgentClient,
  CloudAgentDispatchRequest,
  CloudAgentDispatchResult,
  CloudAgentKind,
} from "./types.js";

/**
 * Real Cursor Cloud Agents API client (v1 public beta).
 * SDLC MVP: each Cloud Agent kind uses its exclusive
 * RELEASEDESK_CURSOR_API_KEY_CODING|TESTING|REVIEW — never shared CURSOR_API_KEY.
 *
 * Docs: https://cursor.com/docs/cloud-agent/api/endpoints
 */

export type CursorCloudAgentKind = CloudAgentKind;

export type RealCloudAgentClientOptions = {
  apiKey?: string;
  /** When set, resolves the exclusive per-kind Cursor key (preferred for SDLC). */
  agentKind?: CloudAgentKind;
  env?: NodeJS.ProcessEnv;
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
 * Resolve exclusive Cursor API key for a Cloud Agent kind.
 * Never falls back to shared CURSOR_API_KEY / CURSOR_SERVICE_ACCOUNT_KEY.
 */
export function resolveCursorApiKeyForAgent(
  kind: CursorCloudAgentKind | CursorKeyedAgentId,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return resolveAgentCursorApiKey(kind, env);
}

/**
 * @deprecated Shared CURSOR_* keys are not used on the SDLC path.
 * Use {@link resolveCursorApiKeyForAgent} instead. Always returns undefined.
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
 * Throws only on programmer misuse (missing key). Network/API failures return failed results
 * so Builder retry logic can handle them.
 */
export function createRealCloudAgentClient(
  options: RealCloudAgentClientOptions = {},
): CloudAgentClient {
  const env = options.env ?? process.env;
  const resolvedKey =
    options.apiKey ??
    (options.agentKind
      ? resolveCursorApiKeyForAgent(options.agentKind, env)
      : undefined);
  if (!resolvedKey) {
    throw new Error(
      options.agentKind
        ? `createRealCloudAgentClient requires exclusive RELEASEDESK_CURSOR_API_KEY for ${options.agentKind} (shared CURSOR_API_KEY is never used)`
        : "createRealCloudAgentClient requires per-agent apiKey (or agentKind for exclusive RELEASEDESK_CURSOR_API_KEY_*)",
    );
  }
  const apiKey: string = resolvedKey;

  const baseUrl = (options.baseUrl ?? "https://api.cursor.com").replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const pollTimeoutMs = options.pollTimeoutMs ?? 15 * 60 * 1000;

  async function createAndWait(
    request: CloudAgentDispatchRequest,
    attempt: number,
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

    const terminal = await pollRun(agentId, runId);
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

  async function pollRun(agentId: string, runId: string): Promise<ApiRun> {
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

      try {
        return await createAndWait(request, attempt);
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
 * Real-mode stub when exclusive per-agent Cursor key is missing.
 * Never falls back to shared CURSOR_API_KEY.
 */
export function createUnavailableRealClientStub(
  agentKind?: CloudAgentKind,
): CloudAgentClient {
  return {
    mode: "real",
    async dispatch(request): Promise<CloudAgentDispatchResult> {
      const kind = agentKind ?? request.agentKind;
      const envVar = CURSOR_API_KEY_ENV[kind];
      const mock = createMockMeta(
        "cursor-cloud-agents",
        `Real client requested but ${envVar} missing (shared CURSOR_API_KEY unused)`,
      );
      return {
        handoffId: request.handoffId,
        agentKind: request.agentKind,
        status: "failed",
        mocked: true,
        mock,
        summary: formatMockNote(
          `Cannot dispatch real Cloud Agent — missing ${envVar}`,
        ),
        attempt: 1,
        error: `missing ${envVar}`,
      };
    },
  };
}
