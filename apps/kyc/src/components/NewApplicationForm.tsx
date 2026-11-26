"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { OCCUPATION_CATEGORIES, type Identity, type OccupationCategory } from "@/lib/domain/types";

const initial: Identity = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  nationality: "US",
  email: "",
  phone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  postalCode: "",
  country: "US",
};

interface IssuedCredential {
  id: string;
  credential: string;
}

export function NewApplicationForm() {
  const router = useRouter();
  const [form, setForm] = useState<Identity>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<IssuedCredential | null>(null);

  function update<K extends keyof Identity>(key: K, value: Identity[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identity: {
            ...form,
            nationality: form.nationality.toUpperCase(),
            country: form.country.toUpperCase(),
            occupation: form.occupationCategory === "Other" ? form.occupation : undefined,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create application");
      setIssued({ id: data.application.id, credential: data.applicantCredential });
      setBusy(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create application");
      setBusy(false);
    }
  }

  if (issued) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[color:var(--nw-ink)]">
          Save this applicant credential. It opens only this case. It is not shown again.
        </p>
        <p className="break-all rounded-md bg-[color:var(--nw-paper)] px-4 py-3 font-mono text-sm">
          {issued.credential}
        </p>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            router.push(`/applications/${issued.id}`);
            router.refresh();
          }}
        >
          Continue to application
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="firstName">
            First name
          </label>
          <input
            id="firstName"
            className="field"
            value={form.firstName}
            onChange={(e) => update("firstName", e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="lastName">
            Last name
          </label>
          <input
            id="lastName"
            className="field"
            value={form.lastName}
            onChange={(e) => update("lastName", e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="dateOfBirth">
            Date of birth
          </label>
          <input
            id="dateOfBirth"
            type="date"
            className="field"
            value={form.dateOfBirth}
            onChange={(e) => update("dateOfBirth", e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="nationality">
            Nationality (ISO)
          </label>
          <input
            id="nationality"
            className="field"
            maxLength={2}
            value={form.nationality}
            onChange={(e) => update("nationality", e.target.value.toUpperCase())}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            className="field"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="phone">
            Phone
          </label>
          <input
            id="phone"
            className="field"
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            required
            minLength={8}
            maxLength={20}
          />
        </div>
        <div>
          <label className="label" htmlFor="occupationCategory">
            Occupation <span className="font-normal normal-case tracking-normal text-[color:var(--nw-steel)]">(optional)</span>
          </label>
          <select
            id="occupationCategory"
            className="field"
            value={form.occupationCategory ?? ""}
            onChange={(e) =>
              update("occupationCategory", (e.target.value || undefined) as OccupationCategory | undefined)
            }
          >
            <option value="">Not provided</option>
            {OCCUPATION_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
        {form.occupationCategory === "Other" ? (
          <div>
            <label className="label" htmlFor="occupation">
              Occupation detail
            </label>
            <input
              id="occupation"
              className="field"
              value={form.occupation ?? ""}
              onChange={(e) => update("occupation", e.target.value)}
              autoComplete="organization-title"
              minLength={2}
              maxLength={80}
              placeholder="Teacher"
              required
            />
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="addressLine1">
            Address line 1
          </label>
          <input
            id="addressLine1"
            className="field"
            value={form.addressLine1}
            onChange={(e) => update("addressLine1", e.target.value)}
            required
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="addressLine2">
            Address line 2
          </label>
          <input
            id="addressLine2"
            className="field"
            value={form.addressLine2 ?? ""}
            onChange={(e) => update("addressLine2", e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="city">
            City
          </label>
          <input
            id="city"
            className="field"
            value={form.city}
            onChange={(e) => update("city", e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="postalCode">
            Postal code
          </label>
          <input
            id="postalCode"
            className="field"
            value={form.postalCode}
            onChange={(e) => update("postalCode", e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="country">
            Country (ISO)
          </label>
          <input
            id="country"
            className="field"
            maxLength={2}
            value={form.country}
            onChange={(e) => update("country", e.target.value.toUpperCase())}
            required
          />
        </div>
      </section>

      {error ? (
        <p className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>
      ) : null}

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Creating…" : "Create draft application"}
      </button>
    </form>
  );
}
