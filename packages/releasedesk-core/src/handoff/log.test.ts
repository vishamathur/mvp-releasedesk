import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildTrace } from "./log.js";
import { readLogDir } from "./log-dir.js";
import { loadProcessDefinitionsSync } from "./processes.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const sample = [
  '{"requestId":"REQ-1","seq":1,"at":"2026-11-22T09:00:01.000Z","event":"transition","pid":"PID-NC","pidVersion":"1.1.0","from":"lead","to":"lead","stage":"proposal","summary":"discovery to proposal"}',
  '{"requestId":"REQ-1","seq":2,"at":"2026-11-22T09:00:02.000Z","event":"gate-decision","pid":"PID-NC","pidVersion":"1.1.0","from":"change-analyst","to":"lead","stage":"proposal","gate":"proposal","decidedBy":"Priya Shah","gateOwner":"change-analyst","verbatim":"2026-11-22T09:00:02.000Z | verbatim: approved","summary":"proposal approved"}',
  '{"requestId":"REQ-1","seq":3,"at":"2026-11-22T09:00:03.000Z","event":"reject","pid":"PID-NC","pidVersion":"1.1.0","from":"lead","to":"lead","stage":"proposal","rejectCode":"bot_cannot_approve","summary":"lead cannot approve","message":{"v":1,"kind":"stage-return","pid":"PID-NC","pidVersion":"1.1.0","requestId":"REQ-1","thread":{"channel":"lead-chat","threadId":"thr_1"},"from":"lead","to":"lead","stage":"proposal","action":"return","summary":"lead cannot approve","artifactRefs":[],"memoryKey":"pid.state.REQ-1","humanGate":{"gate":"proposal","decision":"approved","decidedBy":"lead","note":"2026-11-22T09:00:03.000Z | verbatim: no"}}}',
  "not json",
].join("\n");

describe("Release Desk Log JSONL", () => {
  const processes = loadProcessDefinitionsSync(workspaceRoot);
  const dir = mkdtempSync(path.join(tmpdir(), "releasedesk-log-"));
  writeFileSync(path.join(dir, "REQ-1.jsonl"), `${sample}\n`);
  writeFileSync(path.join(dir, "other.jsonl"), '{"requestId":"REQ-2","seq":1,"at":"2026-11-22T09:00:01.000Z","event":"note","pid":"PID-ER","pidVersion":"1.1.0","from":"log","to":"log","summary":"note"}\n');

  it("reads a directory, skips a bad line, and groups by request", () => {
    const read = readLogDir(dir);
    expect(read.requests["REQ-1"]).toHaveLength(3);
    expect(read.requests["REQ-2"]).toHaveLength(1);
    expect(read.malformed.length).toBeGreaterThanOrEqual(1);
    const seqs = read.requests["REQ-1"]!.map((line) => line.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it("builds a trace with a gate decision and a bot_cannot_approve anomaly", () => {
    const read = readLogDir(dir);
    const trace = buildTrace(read.requests["REQ-1"]!, processes);
    expect(trace.pid).toBe("PID-NC");
    expect(trace.pidVersion).toBe("1.1.0");
    expect(trace.currentStage).toBe("proposal");
    expect(trace.gateDecisions.map((item) => `${item.gate}:${item.decidedBy}`)).toEqual([
      "proposal:Priya Shah",
    ]);
    expect(trace.timeline.some((line) => line.event === "reject" && line.rejectCode === "bot_cannot_approve")).toBe(true);
  });

  it("does not throw when the directory is missing", () => {
    expect(readLogDir(path.join(dir, "missing")).requests).toEqual({});
  });
});
