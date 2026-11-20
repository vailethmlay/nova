import Link from "next/link";
import { count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { applications, auditLog, proposals } from "@/db/schema";
import { eat } from "@/lib/format";

export default async function CommandCenter() {
  const [[apps], [pending], recent] = await Promise.all([
    db().select({ n: count() }).from(applications),
    db().select({ n: count() }).from(proposals).where(eq(proposals.status, "pending")),
    db().select().from(auditLog).orderBy(desc(auditLog.id)).limit(8),
  ]);
  return (
    <>
      <h1>Command center</h1>
      <div className="grid">
        <Link href="/apps" className="card" style={{ textDecoration: "none" }}>
          <div className="stat">{apps.n}</div>
          <div className="label">Registered applications</div>
        </Link>
        <Link href="/approvals" className="card" style={{ textDecoration: "none" }}>
          <div className="stat">{pending.n}</div>
          <div className="label">Pending approvals</div>
        </Link>
        <div className="card tint">
          <div className="stat">—</div>
          <div className="label">Open PRs, failed Actions, issues: GitHub connects in Phase 2</div>
        </div>
        <div className="card tint">
          <div className="stat">—</div>
          <div className="label">Application health: no monitoring evidence yet (Phase 3)</div>
        </div>
      </div>
      <h2>Recent activity</h2>
      <table>
        <thead><tr><th>When</th><th>Actor</th><th>Event</th></tr></thead>
        <tbody>
          {recent.map((r) => (
            <tr key={r.id}><td>{eat(r.at)}</td><td>{r.actor}</td><td><code>{r.event}</code></td></tr>
          ))}
          {recent.length === 0 && <tr><td colSpan={3} className="muted">No activity yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
