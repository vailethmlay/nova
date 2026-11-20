import Link from "next/link";
import { count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { applications, auditLog, proposals } from "@/db/schema";
import { eat } from "@/lib/format";
import { githubConfig } from "@/lib/env";
import { githubCounts } from "@/lib/github/queries";

export default async function CommandCenter() {
  const [[apps], [pending], recent] = await Promise.all([
    db().select({ n: count() }).from(applications),
    db().select({ n: count() }).from(proposals).where(eq(proposals.status, "pending")),
    db().select().from(auditLog).orderBy(desc(auditLog.id)).limit(8),
  ]);
  const gh = githubConfig() ? await githubCounts(db()) : null;
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
        {gh ? (
          <>
            <Link href="/repos" className="card" style={{ textDecoration: "none" }}>
              <div className="stat">{gh.repos}</div>
              <div className="label">Active repositories</div>
            </Link>
            <div className="card"><div className="stat">{gh.openPrs}</div><div className="label">Open pull requests</div></div>
            <div className="card">
              <div className="stat" style={gh.failedRuns7d ? { color: "var(--danger)" } : undefined}>{gh.failedRuns7d}</div>
              <div className="label">Failed GitHub Actions (7 days)</div>
            </div>
            <div className="card"><div className="stat">{gh.openIssues}</div><div className="label">Open issues</div></div>
            <div className="card"><div className="stat">{gh.releases30d}</div><div className="label">Releases (30 days)</div></div>
          </>
        ) : (
          <div className="card tint">
            <div className="stat">—</div>
            <div className="label">GitHub not connected yet (see Integrations)</div>
          </div>
        )}
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
