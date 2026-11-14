#!/usr/bin/env node
/**
 * On-demand release check using real specialist runners (Milestone 4).
 *
 * Usage:
 *   npm run check:release -- --repo owner/name
 *   npx tsx packages/releasedesk-specialists/src/cli.ts --repo owner/name
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { FileBackedRunContextStore, createInMemoryStore } from "@releasedesk/core";
import { LeadOrchestrator } from "@releasedesk/lead";
import { createSpecialistRunners } from "./runners.js";
import { defaultWorkspaceRoot } from "./paths.js";

type CliArgs = {
  repo: string;
  base: string;
  head: string;
  goal: string;
  store: "memory" | "file";
  storePath: string;
  workspace: string;
  json: boolean;
  help: boolean;
};

function printHelp(): void {
  console.log(`Release Desk — Lead + specialists on-demand check (M6)

Usage:
  releasedesk-check --repo <owner/name> [options]

Options:
  --repo <owner/name>     Target repository (required)
  --base <ref>            Base ref (default: main)
  --head <ref>            Head ref (default: HEAD)
  --goal <text>           Check goal
  --workspace <path>      Local git/workspace root (default: monorepo root)
  --store memory|file     Persistence (default: memory)
  --store-path <path>     File store path (default: .releasedesk/runs.json)
  --json                  Print full JSON report
  -h, --help              Show help

Uses specialist runners + Lead verification checkpoints + PR workflow.
External APIs (Grok, NVD, Cursor Cloud, GitHub) are MOCK-labeled when credentials are unavailable.
Human approval gates are requested but never auto-approved / never auto-merged.
`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    repo: "",
    base: "main",
    head: "HEAD",
    goal: "On-demand release readiness check",
    store: "memory",
    storePath: ".releasedesk/runs.json",
    workspace: defaultWorkspaceRoot(),
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value after ${a}`);
      return v;
    };
    switch (a) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "--repo":
        args.repo = next();
        break;
      case "--base":
        args.base = next();
        break;
      case "--head":
        args.head = next();
        break;
      case "--goal":
        args.goal = next();
        break;
      case "--workspace":
        args.workspace = path.resolve(next());
        break;
      case "--store": {
        const v = next();
        if (v !== "memory" && v !== "file") throw new Error(`Invalid --store ${v}`);
        args.store = v;
        break;
      }
      case "--store-path":
        args.storePath = next();
        break;
      case "--json":
        args.json = true;
        break;
      default:
        if (a.startsWith("-")) throw new Error(`Unknown option: ${a}`);
        break;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.repo) {
    printHelp();
    console.error("Error: --repo is required");
    process.exitCode = 1;
    return;
  }

  const store =
    args.store === "file"
      ? new FileBackedRunContextStore(path.resolve(args.storePath))
      : createInMemoryStore();

  if (args.store === "file") {
    await mkdir(path.dirname(path.resolve(args.storePath)), { recursive: true });
  }

  const runners = createSpecialistRunners({
    workspaceRoot: args.workspace,
    skipGrok: true,
  });

  const lead = new LeadOrchestrator({ store, runners });
  const report = await lead.startOnDemandCheck({
    goal: args.goal,
    target: {
      repository: args.repo,
      baseRef: args.base,
      headRef: args.head,
    },
    trigger: {
      requestedBy: "cli",
      notes: "On-demand check via specialists CLI (M6 verification + PR workflow)",
    },
  });

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          runId: report.runId,
          readiness: report.leadOutput.readiness,
          blockingIssues: report.leadOutput.blockingIssues,
          remediationRecommended: report.leadOutput.remediationRecommended,
          delegations: report.delegations,
          approvals: report.approvals,
          checkpoints: report.checkpoints,
          pullRequests: report.pullRequests,
          autoMerge: false,
          tasks: report.run.tasks.map((t) => ({
            id: t.id,
            name: t.name,
            agentRole: t.agentRole,
            status: t.status,
            summary: t.output?.summary,
          })),
          auditTrailSize: report.run.auditTrail.length,
          auditActions: [...new Set(report.run.auditTrail.map((e) => e.action))],
          summary: report.leadOutput.summary,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`Run:        ${report.runId}`);
  console.log(`Status:     ${report.run.status}`);
  console.log(`Readiness:  ${report.leadOutput.readiness}`);
  console.log(`Summary:    ${report.leadOutput.summary}`);
  console.log(`Checkpoints:`);
  for (const c of report.checkpoints.checkpoints) {
    console.log(`  - ${c.stage} [cycle ${c.cycle}]: ${c.status}`);
  }
  console.log(`Pull requests:`);
  if (report.pullRequests.pullRequests.length === 0) {
    console.log(`  (none — no remediation PR this run)`);
  }
  for (const p of report.pullRequests.pullRequests) {
    console.log(
      `  - #${p.prNumber} ${p.url} (autoMerge=false, checks=${p.lastStatus?.checkStatus ?? "n/a"})`,
    );
  }
  console.log(`Delegations:${report.delegations.length}`);
  for (const d of report.delegations) {
    console.log(`  - ${d.agentRole} (${d.taskId}): ${d.rationale}`);
  }
  console.log(`Tasks:`);
  for (const t of report.run.tasks.filter((x) => x.agentRole !== "lead")) {
    console.log(`  - ${t.agentRole}: ${t.status} — ${String(t.output?.summary ?? t.name)}`);
  }
  console.log(`Blocking:   ${report.leadOutput.blockingIssues.length}`);
  for (const b of report.leadOutput.blockingIssues) {
    console.log(`  - ${b}`);
  }
  console.log(`Approvals:`);
  for (const g of report.approvals.gates) {
    console.log(`  - ${g.kind}: ${g.status} (${g.id})`);
  }
  console.log(`Audit events: ${report.run.auditTrail.length}`);
  console.log(
    "\nNote: checkpoints + PR workflow active (M6). External APIs labeled MOCK: when unavailable. Human gates pending — never auto-merge.",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
