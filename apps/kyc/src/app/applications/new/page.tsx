import { AppShell } from "@/components/AppShell";
import { NewApplicationForm } from "@/components/NewApplicationForm";
import { requirePageActor } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewApplicationPage() {
  const actor = await requirePageActor("customer", "/applications/new");
  return (
    <AppShell
      role={actor.role}
      title="New KYC application"
      subtitle="Customer step — capture identity, including an optional occupation. Document placeholders come next. Analyst review is a separate sign-in."
    >
      <div className="rounded-lg border border-[color:var(--nw-sand)] bg-white/80 p-6 sm:p-8">
        <NewApplicationForm />
      </div>
    </AppShell>
  );
}
