import Link from "next/link";
import { AppShell } from "@/components/AppShell";

export default function ApplicationNotFound() {
  return (
    <AppShell title="Application not found" subtitle="That KYC case does not exist in the local store.">
      <Link href="/applications" className="btn-primary">
        Back to applications
      </Link>
    </AppShell>
  );
}
