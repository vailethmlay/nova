import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { LogoutButton } from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return (
    <div className="shell">
      <nav className="side" aria-label="Main">
        <div className="mark">NOVA</div>
        <Link href="/">Command center</Link>
        <Link href="/apps">Applications</Link>
        <Link href="/approvals">Approvals</Link>
        <Link href="/chat">Ask NOVA</Link>
        <Link href="/audit">Audit log</Link>
        <div className="spacer" />
        <LogoutButton />
      </nav>
      <main>{children}</main>
    </div>
  );
}
