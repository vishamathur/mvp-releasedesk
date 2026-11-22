#!/usr/bin/env node
/**
 * On-demand release check CLI for the Lead Agent (M6: verification + PR gates).
 *
 * Usage:
 *   npm run check:release:stubs -- --repo owner/name [--base main] [--head HEAD]
 *   npx tsx packages/releasedesk-lead/src/cli.ts --repo owner/name --json
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { FileBackedRunContextStore, createInMemoryStore } from "@releasedesk/core";
import { LeadOrchestrator } from "./orchestrator.js";
import { resolvePrClient } from "./pr/index.js";

type CliArgs = {
  repo: string;
  base: string;
  head: string;
  goal: string;
  store: "memory" | "file";
  storePath: string;
  json: boolean;
  help: boolean;
  approve: boolean;
  reject: boolean;
  decidedBy: string;
};

function printHelp(): void {
  console.log(`Release Desk — Lead Agent on-demand check (M6)

Usage:
  releasedesk-check --repo <owner/name> [options]

Options:
  --repo <owner/name>   Target repository (required)
  --base <ref>          Base ref (default: main)
  --head <ref>          Head ref (default: HEAD)
  --goal <text>         Check goal
  --store memory|file   Persistence (default: memory)
  --store-path <path>   File store path (default: .releasedesk/runs.json)
  --json                Print full JSON report
  --approve             Record an in-memory approve of merge+release gates (no git merge)
  --reject              Record an in-memory reject of the release gate (no git merge)
  --decided-by <who>    Actor for --approve/--reject (default: cli)
  -h, --help            Show help

Checkpoint verification runs after specialist + cloud-agent stages.
PR workflow uses the real GitHub client. A missing GH_TOKEN or GITHUB_TOKEN throws.
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
    json: false,
    help: false,
    approve: false,
    reject: false,
    decidedBy: "cli",
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
      case "--approve":
        args.approve = true;
        break;
      case "--reject":
        args.reject = true;
        break;
      case "--decided-by":
        args.decidedBy = next();
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
  if (args.approve && args.reject) {
    console.error("Error: --approve and --reject are mutually exclusive");
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

  const prClient = resolvePrClient();
  const lead = new LeadOrchestrator({
    store,
    prClient: { client: prClient },
  });
  let report = await lead.startOnDemandCheck({
    goal: args.goal,
    target: {
      repository: args.repo,
      baseRef: args.base,
      headRef: args.head,
    },
    trigger: { requestedBy: "cli", notes: "On-demand check via releasedesk-check CLI (M6)" },
  });

  if (args.approve) {
    // Explicit CLI demo action: complete feature checklists then merge/release gates.
    // Orchestrator never auto-signs these during the run.
    if (report.featureSignOffs.checklists.length > 0) {
      report = lead.applyFeatureSignOffsToReport(
        report,
        report.featureSignOffs.checklists.map((c) => ({
          checklistId: c.id,
          signOffAll: true,
          signedOffBy: args.decidedBy,
          notes: "CLI --approve feature checklist (in-memory only)",
        })),
      );
    }
    const decisions = report.approvals.gates
      .filter((g) => g.status === "pending")
      .map((g) => ({
        gateId: g.id,
        decision: "approved" as const,
        decidedBy: args.decidedBy,
        notes: "CLI --approve (in-memory only; no git merge)",
      }));
    report = lead.applyApprovalsToReport(report, decisions);
  } else if (args.reject) {
    const release = report.approvals.gates.find(
      (g) => g.kind === "release" && g.status === "pending",
    );
    if (release) {
      report = lead.applyApprovalsToReport(report, [
        {
          gateId: release.id,
          decision: "rejected",
          decidedBy: args.decidedBy,
          notes: "CLI --reject (in-memory only)",
        },
      ]);
    }
  }

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
          featureSignOffs: report.featureSignOffs,
          checkpoints: report.checkpoints,
          pullRequests: report.pullRequests,
          prClientMode: prClient.mode,
          autoMerge: false,
          tasks: report.run.tasks.map((t) => ({
            id: t.id,
            name: t.name,
            agentRole: t.agentRole,
            status: t.status,
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
  console.log(`PR client:  ${prClient.mode}`);
  console.log(`Summary:    ${report.leadOutput.summary}`);
  console.log(`Checkpoints:`);
  for (const c of report.checkpoints.checkpoints) {
    console.log(`  - ${c.stage} [cycle ${c.cycle}]: ${c.status}`);
  }
  console.log(`Pull requests:`);
  if (report.pullRequests.pullRequests.length === 0) {
    console.log(`  (none)`);
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
  console.log(`Blocking:   ${report.leadOutput.blockingIssues.length}`);
  for (const b of report.leadOutput.blockingIssues) {
    console.log(`  - ${b}`);
  }
  console.log(`Feature sign-offs:`);
  if (report.featureSignOffs.checklists.length === 0) {
    console.log(`  (none — no AI-produced features detected)`);
  }
  for (const c of report.featureSignOffs.checklists) {
    const signed = c.items.filter((i) => i.signedOff).length;
    console.log(
      `  - ${c.kind} ${c.status}: ${c.feature.title} (${signed}/${c.items.length} items) [${c.id}]`,
    );
  }
  console.log(`Approvals:`);
  for (const g of report.approvals.gates) {
    console.log(`  - ${g.kind}: ${g.status} (${g.id})`);
  }
  console.log(`Audit events: ${report.run.auditTrail.length}`);
  console.log(
    "\nNote: never auto-merges / never auto-signs feature checklists. Use --approve/--reject for in-memory demos only.",
  );
  console.log(
    "Full check with specialists: npm run check:release -- --repo owner/name --json",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
