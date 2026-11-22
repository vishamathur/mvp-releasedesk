import { describe, expect, it } from "vitest";
import { GET as listLogs } from "@/app/api/handoff/route";
import { GET as readTrace } from "@/app/api/handoff/[requestId]/route";
import { fixtureLogDir, listHandoffLogs, traceHandoffLog } from "./handoff-desk";

describe("handoff log routes", () => {
  it("lists fixture requests when RELEASEDESK_LOG_DIR points at the fixtures", () => {
    const listed = listHandoffLogs({ env: { RELEASEDESK_LOG_DIR: fixtureLogDir() } });
    expect(listed.source).toBe("log");
    expect(listed.copy).toMatch(/Release Desk Log records it/);
    expect(listed.requests.map((item) => item.requestId)).toEqual([
      "REQ-2026-0001",
      "REQ-2026-0002",
      "REQ-2026-0099",
    ]);
    expect(listed.malformed.length).toBeGreaterThanOrEqual(2);
    const er = traceHandoffLog("REQ-2026-0001", { env: { RELEASEDESK_LOG_DIR: fixtureLogDir() } });
    expect(er.ok).toBe(true);
    if (er.ok) {
      expect(er.trace.currentStage).toBe("release-gate");
      expect(er.trace.gateDecisions).toHaveLength(3);
    }
  });

  it("names the env var when the log directory is unset", () => {
    const listed = listHandoffLogs({ env: {} });
    expect(listed.source).toBe("unset");
    expect(listed.requests).toEqual([]);
    expect(listed.logDirEnv).toBe("RELEASEDESK_LOG_DIR");
    const missing = traceHandoffLog("REQ-2026-0001", { env: {} });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain("RELEASEDESK_LOG_DIR");
  });

  it("serves replay fixtures from the GET routes", async () => {
    const listRes = await listLogs(new Request("http://desk.local/api/handoff?replay=1"));
    const list = (await listRes.json()) as { source: string; requests: Array<{ requestId: string }> };
    expect(list.source).toBe("replay");
    expect(list.requests.some((item) => item.requestId === "REQ-2026-0001")).toBe(true);
    const traceRes = await readTrace(new Request("http://desk.local/api/handoff/REQ-2026-0002?replay=1"), {
      params: Promise.resolve({ requestId: "REQ-2026-0002" }),
    });
    expect(traceRes.status).toBe(200);
    const body = (await traceRes.json()) as { ok: boolean; trace: { pid: string; gateDecisions: Array<{ gate: string }> } };
    expect(body.ok).toBe(true);
    expect(body.trace.pid).toBe("PID-NC");
    expect(body.trace.gateDecisions.map((item) => item.gate)).toEqual(["proposal"]);
  });
});
