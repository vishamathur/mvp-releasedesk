import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseJsonl, type LogLine, type MalformedLogLine } from "./log.js";

export type LogDirRead = {
  requests: Record<string, LogLine[]>;
  malformed: MalformedLogLine[];
};

/**
 * Read every `*.jsonl` file in `dir`. A malformed line is reported and skipped.
 * One bad line never throws. Lines are sorted by seq and grouped by requestId.
 */
export function readLogDir(dir: string): LogDirRead {
  const malformed: MalformedLogLine[] = [];
  const grouped = new Map<string, LogLine[]>();
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((file) => file.endsWith(".jsonl"))
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT" || (err as NodeJS.ErrnoException).code === "ENOTDIR") {
      return { requests: {}, malformed: [] };
    }
    throw err;
  }
  for (const file of files) {
    const text = readFileSync(path.join(dir, file), "utf8");
    const parsed = parseJsonl(text, file);
    malformed.push(...parsed.malformed);
    for (const line of parsed.lines) {
      const bucket = grouped.get(line.requestId) ?? [];
      bucket.push(line);
      grouped.set(line.requestId, bucket);
    }
  }
  const requests: Record<string, LogLine[]> = {};
  for (const [requestId, lines] of grouped) {
    requests[requestId] = lines.sort((a, b) => a.seq - b.seq || a.at.localeCompare(b.at));
  }
  return { requests, malformed };
}
