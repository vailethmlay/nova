import { asc, desc, sql } from "drizzle-orm";
import { auditLog } from "@/db/schema";
import type { Db } from "@/db/types";
import { canonicalJson, sha256Hex } from "./canonical";
import { redactDeep } from "./redact";

export const GENESIS_HASH = "0".repeat(64);
const AUDIT_LOCK_KEY = 4_815_162_342; // serialises appends so the chain never forks

export type AuditEntry = {
  actor: string; // "owner", "nova", "executor", "system"
  event: string; // e.g. "proposal.created", "approval.granted"
  proposalId?: string | null;
  details?: Record<string, unknown>;
};

function entryHash(prevHash: string, at: Date, e: Required<AuditEntry>): string {
  return sha256Hex(
    prevHash +
      canonicalJson({
        at: at.toISOString(),
        actor: e.actor,
        event: e.event,
        proposalId: e.proposalId,
        details: e.details,
      }),
  );
}

/** Appends one entry to the hash-chained audit log. Details are redacted first. */
export async function appendAudit(db: Db, entry: AuditEntry) {
  const e: Required<AuditEntry> = {
    actor: entry.actor,
    event: entry.event,
    proposalId: entry.proposalId ?? null,
    details: redactDeep(JSON.parse(JSON.stringify(entry.details ?? {}))),
  };
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`);
    const [last] = await tx
      .select({ hash: auditLog.hash })
      .from(auditLog)
      .orderBy(desc(auditLog.id))
      .limit(1);
    const prevHash = last?.hash ?? GENESIS_HASH;
    // Millisecond precision so the stored value round-trips exactly.
    const at = new Date();
    const hash = entryHash(prevHash, at, e);
    const [row] = await tx
      .insert(auditLog)
      .values({ at, actor: e.actor, event: e.event, proposalId: e.proposalId, details: e.details, prevHash, hash })
      .returning();
    return row;
  });
}

/** Recomputes the whole chain. Returns the first broken entry id, if any. */
export async function verifyAuditChain(db: Db): Promise<{ ok: boolean; entries: number; brokenAt?: number }> {
  const rows = await db.select().from(auditLog).orderBy(asc(auditLog.id));
  let prev = GENESIS_HASH;
  for (const r of rows) {
    const expected = entryHash(prev, r.at, {
      actor: r.actor,
      event: r.event,
      proposalId: r.proposalId,
      details: r.details as Record<string, unknown>,
    });
    if (r.prevHash !== prev || r.hash !== expected) return { ok: false, entries: rows.length, brokenAt: r.id };
    prev = r.hash;
  }
  return { ok: true, entries: rows.length };
}
