import { riskLabel, statusLabel } from "@/lib/domain/status";
import type { ApplicationStatus, RiskLevel } from "@/lib/domain/types";

const statusStyles: Record<ApplicationStatus, string> = {
  draft: "bg-slate-200 text-slate-800",
  submitted: "bg-sky-100 text-sky-900",
  in_review: "bg-amber-100 text-amber-900",
  approved: "bg-emerald-100 text-emerald-900",
  rejected: "bg-rose-100 text-rose-900",
  needs_info: "bg-orange-100 text-orange-900",
};

const riskStyles: Record<RiskLevel, string> = {
  low: "bg-emerald-100 text-emerald-900",
  medium: "bg-amber-100 text-amber-900",
  high: "bg-rose-100 text-rose-900",
};

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return <span className={`status-pill ${statusStyles[status]}`}>{statusLabel(status)}</span>;
}

export function RiskBadge({ level }: { level: RiskLevel }) {
  return <span className={`status-pill ${riskStyles[level]}`}>{riskLabel(level)}</span>;
}
