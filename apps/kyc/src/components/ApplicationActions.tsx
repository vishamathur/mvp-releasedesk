"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MockBanner } from "@/components/MockBanner";
import type { ApplicationStatus, DocumentType, KycApplication } from "@/lib/domain/types";

const DOC_TYPES: { value: DocumentType; label: string }[] = [
  { value: "passport", label: "Passport" },
  { value: "national_id", label: "National ID" },
  { value: "drivers_license", label: "Driver’s license" },
  { value: "proof_of_address", label: "Proof of address" },
  { value: "selfie", label: "Selfie / liveness (optional)" },
];

export function ApplicationActions({
  application,
  role,
}: {
  application: KycApplication;
  role: "customer" | "analyst";
}) {
  const router = useRouter();
  const [docType, setDocType] = useState<DocumentType>("passport");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const customerEditing =
    role === "customer" && (application.status === "draft" || application.status === "needs_info");
  const canSubmit = customerEditing;
  const canReview =
    role === "analyst" &&
    (application.status === "submitted" || application.status === "in_review");

  async function refresh() {
    router.refresh();
  }

  async function addDocument(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/applications/${application.id}/documents`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: docType, fileName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setFileName("");
      setInfo(data.mock?.note ?? "Document placeholder recorded.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/applications/${application.id}/submit`, {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submit failed");
      setInfo(data.mock?.note ?? "Submitted.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(
    status: Extract<ApplicationStatus, "in_review" | "approved" | "rejected" | "needs_info">,
    note: string,
  ) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/applications/${application.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      setInfo(`Status updated to ${status}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      {customerEditing ? (
        <section className="space-y-4">
          <h2 className="font-display text-2xl text-[color:var(--nw-ink)]">Documents</h2>
          <MockBanner>
            Upload is mocked: enter a filename only. No bytes are stored. OCR text is fabricated
            locally — no document intelligence API is called.
          </MockBanner>
          <form onSubmit={addDocument} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div>
              <label className="label" htmlFor="docType">
                Document type
              </label>
              <select
                id="docType"
                className="field"
                value={docType}
                onChange={(e) => setDocType(e.target.value as DocumentType)}
              >
                {DOC_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="fileName">
                File name
              </label>
              <input
                id="fileName"
                className="field"
                placeholder="passport-scan.pdf"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn-secondary" disabled={busy}>
              Add placeholder
            </button>
          </form>
        </section>
      ) : null}

      {canSubmit ? (
        <section className="space-y-3">
          <h2 className="font-display text-2xl text-[color:var(--nw-ink)]">Submit</h2>
          <p className="text-sm text-[color:var(--nw-steel)]">
            Requires one government ID and proof of address. Risk scoring runs locally on submit.
          </p>
          <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
            Submit for review
          </button>
        </section>
      ) : null}

      {canReview ? (
        <section className="space-y-3">
          <h2 className="font-display text-2xl text-[color:var(--nw-ink)]">Analyst actions</h2>
          <div className="flex flex-wrap gap-2">
            {application.status === "submitted" ? (
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => setStatus("in_review", "Moved to analyst review")}
              >
                Start review
              </button>
            ) : null}
            {application.status === "in_review" ? (
              <>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => setStatus("approved", "Approved by demo analyst")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => setStatus("needs_info", "Request additional documents")}
                >
                  Needs info
                </button>
                <button
                  type="button"
                  className="btn-secondary !border-rose-300 !text-rose-800"
                  disabled={busy}
                  onClick={() => setStatus("rejected", "Rejected in demo review")}
                >
                  Reject
                </button>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      {error ? (
        <p className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>
      ) : null}
      {info ? (
        <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{info}</p>
      ) : null}
    </div>
  );
}
