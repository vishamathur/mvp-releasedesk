import { ALLOWED_TRANSITIONS, type ApplicationStatus } from "./types";

export function canTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function transitionStatus(
  from: ApplicationStatus,
  to: ApplicationStatus,
): ApplicationStatus {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid status transition: ${from} → ${to}`);
  }
  return to;
}

export function statusLabel(status: ApplicationStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "submitted":
      return "Submitted";
    case "in_review":
      return "In review";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "needs_info":
      return "Needs information";
  }
}

export function riskLabel(level: "low" | "medium" | "high"): string {
  switch (level) {
    case "low":
      return "Low risk";
    case "medium":
      return "Medium risk";
    case "high":
      return "High risk";
  }
}
