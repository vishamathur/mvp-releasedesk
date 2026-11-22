import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET as listLogs } from "@/app/api/handoff/route";
import { GET as readTrace } from "@/app/api/handoff/[requestId]/route";
import { listHandoffLogs, traceHandoffLog } from "./handoff-desk";

const line = JSON.stringify({
  requestId: "REQ-1",
  seq: 1,
  at: "2026-11-22T09:00:01.000Z",
  event: "transition",
  pid: "PID-NC",
  pidVersion: "1.1.0",
  from: "lead",
  to: "lead",
  stage: "intake",
  summary: "opened",
});

describe("handoff log routes", () => {
  it("lists a real log directory and does not expose a replay source", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "releasedesk-log-"));
    writeFileSync(path.join(dir, "REQ-1.jsonl"), `${line}\n`);
    const previous = process.env.RELEASEDESK_LOG_DIR;
    process.env.RELEASEDESK_LOG_DIR = dir;
    try {
      const listed = listHandoffLogs();
      expect(listed.source).toBe("log");
      expect(listed.requests.map((item) => item.requestId)).toEqual(["REQ-1"]);
      const traced = traceHandoffLog("REQ-1");
      expect(traced.ok).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.RELEASEDESK_LOG_DIR;
      else process.env.RELEASEDESK_LOG_DIR = previous;
    }
  });

  it("names the env var when the log directory is unset", () => {
    const previous = process.env.RELEASEDESK_LOG_DIR;
    delete process.env.RELEASEDESK_LOG_DIR;
    try {
      const listed = listHandoffLogs({ env: {} });
      expect(listed.source).toBe("unset");
      expect(listed.requests).toEqual([]);
      expect(listed.logDirEnv).toBe("RELEASEDESK_LOG_DIR");
      const missing = traceHandoffLog("REQ-1", { env: {} });
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.error).toContain("RELEASEDESK_LOG_DIR");
    } finally {
      if (previous === undefined) delete process.env.RELEASEDESK_LOG_DIR;
      else process.env.RELEASEDESK_LOG_DIR = previous;
    }
  });

  it("GET routes read RELEASEDESK_LOG_DIR and return 404 for an unknown request", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "releasedesk-log-"));
    writeFileSync(path.join(dir, "REQ-1.jsonl"), `${line}\n`);
    const previous = process.env.RELEASEDESK_LOG_DIR;
    process.env.RELEASEDESK_LOG_DIR = dir;
    try {
      const listRes = await listLogs(new Request("http://desk.local/api/handoff"));
      const list = (await listRes.json()) as { source: string; requests: Array<{ requestId: string }> };
      expect(list.source).toBe("log");
      expect(list.requests.map((item) => item.requestId)).toEqual(["REQ-1"]);
      const missing = await readTrace(new Request("http://desk.local/api/handoff/REQ-missing"), {
        params: Promise.resolve({ requestId: "REQ-missing" }),
      });
      expect(missing.status).toBe(404);
    } finally {
      if (previous === undefined) delete process.env.RELEASEDESK_LOG_DIR;
      else process.env.RELEASEDESK_LOG_DIR = previous;
    }
  });
});
