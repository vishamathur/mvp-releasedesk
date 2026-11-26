import { AppShell } from "@/components/AppShell";
import { LoginForm } from "@/components/LoginForm";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ next?: string; reason?: string }> };

function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("://")) {
    return "/";
  }
  return value;
}

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
            KYC auth is not configured. Set KYC_CUSTOMER_TOKEN and KYC_ANALYST_TOKEN in
            apps/kyc/.env.local. Each token must be at least 16 characters, and they must differ.
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
