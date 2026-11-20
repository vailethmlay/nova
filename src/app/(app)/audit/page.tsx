import { desc } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { verifyAuditChain } from "@/lib/audit";
import { eat } from "@/lib/format";

export default async function AuditPage() {
  const [rows, chain] = await Promise.all([
    db().select().from(auditLog).orderBy(desc(auditLog.id)).limit(200),
    verifyAuditChain(db()),
  ]);
  return (
    <>
      <h1>Audit log</h1>
      <p className={chain.ok ? "ok" : "error"}>
        {chain.ok
          ? `Chain intact: all ${chain.entries} entries verified.`
          : `Chain broken at entry #${chain.brokenAt}. The log may have been tampered with.`}
      </p>
      <table>
        <thead><tr><th>#</th><th>When</th><th>Actor</th><th>Event</th><th>Details</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td>{eat(r.at)}</td>
              <td>{r.actor}</td>
              <td><code>{r.event}</code></td>
              <td><code>{JSON.stringify(r.details)}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
