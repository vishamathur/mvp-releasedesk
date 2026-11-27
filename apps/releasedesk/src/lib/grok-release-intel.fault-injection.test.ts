/**
 * Fault injection for the release-intel client.
 * A local HTTP server stands in for the network fault only. It is not Grok output.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { renderReleaseIntelFailure } from "./release-intel-comment";
import {
  RELEASE_INTEL_TIMEOUT_MS,
  resolveReleaseIntelTimeoutMs,
  runGrokReleaseIntel,
} from "./grok-release-intel";

const KEY = "lead-exclusive-fault-test-key";
const INPUT = {
  repository: "vishamathur/mvp-releasedesk",
  goal: "fault injection",
  findings: [] as Array<{ source: string; text: string }>,
};

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server = createServer((req, res) => {
    try {
      handler(req, res);
    } catch {
      if (!res.writableEnded) res.end();
    }
  });
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}/v1/chat/completions`,
        close: () =>
          new Promise((done, fail) => {
            for (const socket of sockets) socket.destroy();
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}

async function expectVisibleFailure(
  endpoint: string,
  timeoutMs: number,
): Promise<string> {
  let settled: unknown = "did-not-settle";
  try {
    settled = await runGrokReleaseIntel(INPUT, {
      endpoint,
      timeoutMs,
      env: { RELEASEDESK_GROK_API_KEY_LEAD: KEY },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    expect(message).not.toContain(KEY);
    expect(message.toLowerCase()).not.toMatch(/risk low|risktier.: .low/);
    const comment = renderReleaseIntelFailure(message);
    expect(comment.startsWith("## release-intel v1\n")).toBe(true);
    expect(comment).toContain("**Status** failed");
    expect(comment).toContain(message.slice(0, 80));
    expect(comment).toContain("Risk was not assessed");
    expect(comment).toContain("No blockers were recorded");
    expect(comment.toLowerCase()).not.toMatch(/\*\*risk\*\* low/);
    expect(comment).not.toContain('"riskTier": "low"');
    expect(comment).not.toContain(KEY);
    return message;
  }
  throw new Error(`fault was treated as success: ${JSON.stringify(settled)}`);
}

describe("release-intel fault injection", () => {
  it("keeps the default timeout at 120000 ms unless an override is set", () => {
    expect(RELEASE_INTEL_TIMEOUT_MS).toBe(120_000);
    expect(resolveReleaseIntelTimeoutMs({})).toBe(120_000);
    expect(resolveReleaseIntelTimeoutMs({ RELEASE_INTEL_TIMEOUT_MS: " 250 " })).toBe(250);
    expect(resolveReleaseIntelTimeoutMs({}, 40)).toBe(40);
    expect(() => resolveReleaseIntelTimeoutMs({ RELEASE_INTEL_TIMEOUT_MS: "0" })).toThrow(
      /positive integer/,
    );
  });

  it("fault-injection: times out when the local server answers after the timeout", async () => {
    const fault = await listen((_req, res) => {
      setTimeout(() => {
        if (res.destroyed || res.writableEnded) return;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [] }));
      }, 1_500).unref();
    });
    try {
      const message = await expectVisibleFailure(fault.url, 80);
      expect(message).toBe("Grok request timed out after 80 ms");
    } finally {
      await fault.close();
    }
  });

  it("fault-injection: fails when the local server returns HTTP 200 with an empty body", async () => {
    const fault = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("");
    });
    try {
      const message = await expectVisibleFailure(fault.url, 2_000);
      expect(message).toBe("Grok response content was empty");
    } finally {
      await fault.close();
    }
  });

  it("fault-injection: fails when the local server returns an empty choices array", async () => {
    const fault = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [] }));
    });
    try {
      const message = await expectVisibleFailure(fault.url, 2_000);
      expect(message).toBe("Grok response had no choices");
    } finally {
      await fault.close();
    }
  });

  it("fault-injection: fails when the local server returns non-JSON text", async () => {
    const fault = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("not json at all");
    });
    try {
      const message = await expectVisibleFailure(fault.url, 2_000);
      expect(message).toBe("Grok response was not JSON");
    } finally {
      await fault.close();
    }
  });

  it("fault-injection: fails when the local server returns JSON outside release-intel.v2", async () => {
    const fault = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  riskTier: "low",
                  blockers: ["B1"],
                  summarize: "looks fine",
                }),
              },
            },
          ],
        }),
      );
    });
    try {
      const message = await expectVisibleFailure(fault.url, 2_000);
      expect(message).toMatch(/Grok response failed the trust check/);
      expect(message).not.toContain("B1");
    } finally {
      await fault.close();
    }
  });
});
