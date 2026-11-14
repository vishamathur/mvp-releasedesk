import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ApplicationActions } from "@/components/ApplicationActions";
import { MockBanner } from "@/components/MockBanner";
import { RiskBadge, StatusBadge } from "@/components/StatusBadge";
import { getApplication } from "@/lib/store";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function ApplicationDetailPage({ params }: Props) {
  const { id } = await params;
  const application = await getApplication(id);
  if (!application) notFound();

  const identity = application.identity;

  return (
    <AppShell
      title={application.reference}
      subtitle={
        identity
          ? `${identity.firstName} ${identity.lastName} · ${identity.email}`
          : "KYC application detail"
      }
    >
      <div className="mb-6">
        <Link href="/applications" className="btn-ghost px-0">
          ← All applications
        </Link>
      </div>

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <StatusBadge status={application.status} />
        {application.risk ? <RiskBadge level={application.risk.level} /> : null}
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-8">
          <section className="rounded-lg border border-[color:var(--nw-sand)] bg-white/80 p-6">
            <h2 className="font-display text-2xl text-[color:var(--nw-ink)]">Identity</h2>
            {identity ? (
              <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
                <div>
                  <dt className="label">Legal name</dt>
                  <dd>
                    {identity.firstName} {identity.lastName}
                  </dd>
                </div>
                <div>
                  <dt className="label">Date of birth</dt>
                  <dd>{identity.dateOfBirth}</dd>
                </div>
                <div>
                  <dt className="label">Nationality</dt>
                  <dd>{identity.nationality}</dd>
                </div>
                <div>
                  <dt className="label">Phone</dt>
                  <dd>{identity.phone}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="label">Address</dt>
                  <dd>
                    {identity.addressLine1}
                    {identity.addressLine2 ? `, ${identity.addressLine2}` : ""}
                    <br />
                    {identity.city}, {identity.postalCode}, {identity.country}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-3 text-[color:var(--nw-steel)]">No identity on file.</p>
            )}
          </section>

          <section className="rounded-lg border border-[color:var(--nw-sand)] bg-white/80 p-6">
            <h2 className="font-display text-2xl text-[color:var(--nw-ink)]">Documents</h2>
            {application.documents.length === 0 ? (
              <p className="mt-3 text-sm text-[color:var(--nw-steel)]">No documents yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {application.documents.map((doc) => (
                  <li
                    key={doc.id}
                    className="rounded-md border border-[color:var(--nw-sand)]/80 px-4 py-3 text-sm"
                  >
                    <p className="font-semibold text-[color:var(--nw-ink)]">
                      {doc.type.replaceAll("_", " ")} · {doc.fileName}
                    </p>
                    <p className="mt-1 text-[color:var(--nw-steel)]">{doc.mockStorageKey}</p>
                    {doc.mockOcrSummary ? (
                      <p className="mt-2 text-[color:var(--nw-steel)]">{doc.mockOcrSummary}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="rounded-lg border border-[color:var(--nw-sand)] bg-white/80 p-6">
            <ApplicationActions application={application} />
          </div>
        </div>

        <aside className="space-y-6">
          <section className="rounded-lg border border-[color:var(--nw-sand)] bg-white/80 p-6">
            <h2 className="font-display text-2xl text-[color:var(--nw-ink)]">Risk</h2>
            {application.risk ? (
              <div className="mt-4 space-y-3 text-sm">
                <p>
                  Score <strong>{application.risk.score}</strong> ·{" "}
                  <RiskBadge level={application.risk.level} />
                </p>
                <ul className="list-disc space-y-1 pl-5 text-[color:var(--nw-steel)]">
                  {application.risk.factors.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <MockBanner>{application.risk.mockScreeningNote}</MockBanner>
              </div>
            ) : (
              <p className="mt-3 text-sm text-[color:var(--nw-steel)]">
                Risk is calculated when the application is submitted.
              </p>
            )}
          </section>

          <section className="rounded-lg border border-[color:var(--nw-sand)] bg-white/80 p-6">
            <h2 className="font-display text-2xl text-[color:var(--nw-ink)]">Audit notes</h2>
            <ul className="mt-4 space-y-2 text-sm text-[color:var(--nw-steel)]">
              {application.notes.map((note, idx) => (
                <li key={`${idx}-${note}`} className="border-l-2 border-[color:var(--nw-teal)] pl-3">
                  {note}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
