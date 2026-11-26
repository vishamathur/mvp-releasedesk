import { AppShell } from "@/components/AppShell";
import { LoginForm } from "@/components/LoginForm";
import { safeNext } from "@/lib/safe-next";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ next?: string; reason?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const nextHref = safeNext(params.next);
  const reason = params.reason;

  return (
    <AppShell
      title="Sign in"
      subtitle="Customer and analyst access use different tokens. Listing, review, and deletion stay on the analyst token."
    >
      <div className="max-w-lg rounded-lg border border-[color:var(--nw-sand)] bg-white/80 p-6 sm:p-8">
        {reason === "config" ? (
          <p className="mb-4 rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-800">
            Sign-in is not configured. An operator must finish demo auth setup before this app can accept a session.
          </p>
        ) : null}
        {reason === "analyst" ? (
          <p className="mb-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-950">
            This page needs the analyst token.
          </p>
        ) : null}
        {reason === "customer" ? (
          <p className="mb-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-950">
            This page needs the customer token.
          </p>
        ) : null}
        <LoginForm nextHref={nextHref} />
      </div>
    </AppShell>
  );
}
