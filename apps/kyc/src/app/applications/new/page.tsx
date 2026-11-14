import { AppShell } from "@/components/AppShell";
import { NewApplicationForm } from "@/components/NewApplicationForm";

export default function NewApplicationPage() {
  return (
    <AppShell
      title="New KYC application"
      subtitle="Step 1 — capture customer identity. You will add document placeholders next."
    >
      <div className="rounded-lg border border-[color:var(--nw-sand)] bg-white/80 p-6 sm:p-8">
        <NewApplicationForm />
      </div>
    </AppShell>
  );
}
