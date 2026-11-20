import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { whatsappLink } from "@/db/schema";
import type { Db } from "@/db/types";
import { appendAudit } from "@/lib/audit";
import { sha256Hex } from "@/lib/canonical";

const CODE_TTL_MS = 10 * 60 * 1000;

export async function getLink(db: Db) {
  const [row] = await db.select().from(whatsappLink).where(eq(whatsappLink.id, 1));
  return row ?? null;
}

/** Issues a fresh one-time 6-digit code (shown once on the dashboard). Replaces any earlier code. */
export async function createLinkCode(db: Db) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const values = { id: 1, linkCodeHash: sha256Hex(`nova-link:${code}`), linkCodeExpiresAt: new Date(Date.now() + CODE_TTL_MS) };
  await db.insert(whatsappLink).values(values).onConflictDoUpdate({ target: whatsappLink.id, set: values });
  await appendAudit(db, { actor: "owner", event: "whatsapp.link_code_issued", details: {} });
  return code;
}

/** Links the sender as the owner if the message is "link <code>" with a valid, unexpired code. Single use. */
export async function tryLink(db: Db, waId: string, text: string, now = new Date()) {
  const m = text.trim().match(/^link\s+(\d{6})$/i);
  if (!m) return false;
  const row = await getLink(db);
  const ok =
    !!row?.linkCodeHash &&
    !!row.linkCodeExpiresAt &&
    row.linkCodeExpiresAt > now &&
    row.linkCodeHash === sha256Hex(`nova-link:${m[1]}`);
  if (!ok) {
    await appendAudit(db, { actor: "system", event: "whatsapp.link_failed", details: { senderSuffix: waId.slice(-4) } });
    return false;
  }
  await db
    .update(whatsappLink)
    .set({ ownerWaId: waId, linkedAt: now, lastInboundAt: now, linkCodeHash: null, linkCodeExpiresAt: null })
    .where(eq(whatsappLink.id, 1));
  await appendAudit(db, { actor: "owner", event: "whatsapp.linked", details: { numberSuffix: waId.slice(-4) } });
  return true;
}

export async function unlink(db: Db) {
  await db
    .update(whatsappLink)
    .set({ ownerWaId: null, linkedAt: null, lastInboundAt: null, linkCodeHash: null, linkCodeExpiresAt: null })
    .where(eq(whatsappLink.id, 1));
  await appendAudit(db, { actor: "owner", event: "whatsapp.unlinked", details: {} });
}
