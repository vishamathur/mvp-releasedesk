import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { RiskBadge, StatusBadge } from "@/components/StatusBadge";
import { SeedButton } from "@/components/SeedButton";
import { requirePageActor } from "@/lib/session";
import { listApplications } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ApplicationsPage() {
  const actor = await requirePageActor("analyst", "/applications");
  const applications = await listApplications();

  return (
    <AppShell
      role={actor.role}
      title="KYC applications"
      subtitle="Analyst queue. Synthetic demo store, encrypted at rest. Abandoned drafts and rejected cases age out after 90 days. Approved cases follow the longer KYC retention period."
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <SeedButton />
      </div>

      {applications.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[color:var(--nw-sand)] bg-white/60 px-6 py-16 text-center">
          <p className="font-display text-2xl text-[color:var(--nw-ink)]">No applications yet</p>
          <p className="mt-2 text-[color:var(--nw-steel)]">
            Load the synthetic sample set. Customer applications are started from a separate sign-in.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[color:var(--nw-sand)] bg-white/80">
          <table className="w-full text-left text-sm">
            <thead className="bg-[color:var(--nw-paper)] text-xs uppercase tracking-[0.08em] text-[color:var(--nw-steel)]">
              <tr>
                <th className="px-4 py-3 font-semibold">Reference</th>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold">Occupation</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Risk</th>
                <th className="px-4 py-3 font-semibold">Updated</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((app) => (
                <tr key={app.id} className="border-t border-[color:var(--nw-sand)]/80">
                  <td className="px-4 py-3">
                    <Link
                      href={`/applications/${app.id}`}
                      className="font-semibold text-[color:var(--nw-teal)] hover:underline"
                    >
                      {app.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[color:var(--nw-ink)]">
                    {app.identity
                      ? `${app.identity.firstName} ${app.identity.lastName}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-[color:var(--nw-ink)]">
                    {app.identity?.occupationCategory === "Other"
                      ? app.identity.occupation || "Other"
                      : app.identity?.occupationCategory || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={app.status} />
                  </td>
                  <td className="px-4 py-3">
                    {app.risk ? <RiskBadge level={app.risk.level} /> : "—"}
                  </td>
                  <td className="px-4 py-3 text-[color:var(--nw-steel)]">
                    {new Date(app.updatedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
