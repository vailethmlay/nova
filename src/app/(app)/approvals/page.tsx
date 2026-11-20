import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { approvals, proposals } from "@/db/schema";
import { ACTIONS, isKnownAction } from "@/lib/approvals/registry";
import { ApproveButton, RunButton } from "@/components/ApprovalButtons";
import { eat } from "@/lib/format";
import { createTestProposal, rejectAction } from "./actions";

export default async function ApprovalsPage() {
  const now = new Date();
  const open = await db()
    .select()
    .from(proposals)
    .where(inArray(proposals.status, ["pending", "approved"]))
    .orderBy(desc(proposals.createdAt));
  const live = await db()
    .select({ proposalId: approvals.proposalId, expiresAt: approvals.expiresAt })
    .from(approvals)
    .where(and(isNull(approvals.usedAt), gt(approvals.expiresAt, now)));
  const liveBy = new Map(live.map((a) => [a.proposalId, a.expiresAt]));
  const history = await db()
    .select()
    .from(proposals)
    .where(inArray(proposals.status, ["rejected", "executed", "failed", "executing"]))
    .orderBy(desc(proposals.createdAt))
    .limit(20);

  return (
    <>
      <h1>Approvals</h1>
      <p className="muted">
        Each approval is tied to the exact operation shown, expires after 30 minutes and works once. If anything changes,
        NOVA must ask again.
      </p>
      <form action={createTestProposal} style={{ marginBottom: 24 }}>
        <button className="secondary">Create a test proposal</button>
      </form>

      {open.length === 0 && <p className="muted">Nothing is waiting for you.</p>}
      {open.map((p) => {
        const title = isKnownAction(p.actionType) ? ACTIONS[p.actionType].title : p.actionType;
        const expires = liveBy.get(p.id);
        return (
          <section key={p.id} className="card" style={{ marginBottom: 16 }}>
            <h2>
              {title} <span className={`pill ${p.riskLevel}`}>{p.riskLevel} risk</span>
            </h2>
            <dl className="fields">
              <dt>1. Proposed action</dt><dd><code>{p.actionType}</code> (Category {p.category})</dd>
              <dt>2. Reason</dt><dd>{p.reason}</dd>
              <dt>3. Application / repo</dt><dd>{p.target}</dd>
              <dt>4. Files or systems</dt><dd>{p.affected}</dd>
              <dt>5. Consequences</dt><dd>{p.consequences}</dd>
              <dt>6. Risks</dt><dd>{p.risks}</dd>
              <dt>7. Rollback</dt><dd>{p.rollback}</dd>
              <dt>8. Exact operation</dt><dd><pre>{JSON.stringify(p.operation, null, 2)}</pre></dd>
              <dt>Operation hash</dt><dd><code>{p.opHash.slice(0, 16)}…</code></dd>
              <dt>Proposed</dt><dd>{eat(p.createdAt)} by {p.proposedBy}</dd>
            </dl>
            {p.status === "pending" ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <ApproveButton id={p.id} />
                <form action={rejectAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <button className="secondary">Reject</button>
                </form>
              </div>
            ) : expires ? (
              <div>
                <p className="ok">Approved. Valid until {eat(expires)}.</p>
                <RunButton id={p.id} />
              </div>
            ) : (
              <p className="muted">Approval expired or used. Create a new proposal to try again.</p>
            )}
          </section>
        );
      })}

      <h2 style={{ marginTop: 32 }}>History</h2>
      <table>
        <thead><tr><th>Proposed</th><th>Action</th><th>Target</th><th>Outcome</th></tr></thead>
        <tbody>
          {history.map((p) => (
            <tr key={p.id}><td>{eat(p.createdAt)}</td><td><code>{p.actionType}</code></td><td>{p.target}</td><td>{p.status}</td></tr>
          ))}
          {history.length === 0 && <tr><td colSpan={4} className="muted">No decisions yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
