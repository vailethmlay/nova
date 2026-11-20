import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { proposals, whatsappLink } from "@/db/schema";
import type { Db } from "@/db/types";
import { createProposal } from "@/lib/approvals/engine";
import type { Button, WhatsAppSender } from "@/lib/whatsapp/api";
import { templateSafe } from "@/lib/whatsapp/api";
import { handleInbound } from "@/lib/whatsapp/inbound";
import { createLinkCode } from "@/lib/whatsapp/link";
import { approveButtonId, notifyOwner, rejectButtonId } from "@/lib/whatsapp/notify";
import { verifyMetaSignature } from "@/lib/whatsapp/signature";
import { testDb } from "./helpers";

beforeAll(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgres://unused", NOVA_ORIGIN: "https://nova.example.com", NOVA_RP_ID: "nova.example.com",
    NOVA_SETUP_TOKEN: "x".repeat(32), WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_ACCESS_TOKEN: "t",
    WHATSAPP_APP_SECRET: "appsecret", WHATSAPP_VERIFY_TOKEN: "v", WHATSAPP_ALERT_TEMPLATE: "nova_alert",
  });
});

type Sent = { kind: string; to: string; body: string; buttons?: Button[]; params?: string[] };
function fakeSender() {
  const sent: Sent[] = [];
  const sender: WhatsAppSender = {
    text: async (to, body) => void sent.push({ kind: "text", to, body }),
    buttons: async (to, body, buttons) => void sent.push({ kind: "buttons", to, body, buttons }),
    template: async (to, name, _l, params) => void sent.push({ kind: "template", to, body: name, params }),
  };
  return { sent, sender };
}

const OWNER = "255700000001";
const STRANGER = "255700000099";
const fields = { reason: "r", target: "t", affected: "a", consequences: "c", risks: "x", rollback: "b", proposedBy: "nova" as const };
let db: Db;
let msgId = 0;
const text = (from: string, body: string) => ({ id: `wamid.${++msgId}`, from, type: "text", text: { body } });
const button = (from: string, id: string) => ({ id: `wamid.${++msgId}`, from, type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: "x" } } });

async function linkOwner(sender: WhatsAppSender) {
  const code = await createLinkCode(db);
  await handleInbound(db, text(OWNER, `link ${code}`), { sender, origin: "https://nova.example.com" });
}

beforeEach(async () => { db = (await testDb()).db; });

describe("Meta signature", () => {
  it("verifies HMAC-SHA256 of the raw body", () => {
    const body = '{"x":1}';
    const sig = "sha256=" + createHmac("sha256", "appsecret").update(body).digest("hex");
    expect(verifyMetaSignature(body, sig, "appsecret")).toBe(true);
    expect(verifyMetaSignature(body + " ", sig, "appsecret")).toBe(false);
    expect(verifyMetaSignature(body, null, "appsecret")).toBe(false);
    expect(verifyMetaSignature(body, "sha256=zz", "appsecret")).toBe(false);
  });
});

describe("linking", () => {
  it("ignores everyone until linked, and a wrong code does not link", async () => {
    const { sent, sender } = fakeSender();
    await createLinkCode(db);
    await handleInbound(db, text(STRANGER, "status"), { sender, origin: "o" });
    await handleInbound(db, text(STRANGER, "link 000000"), { sender, origin: "o" });
    expect(sent).toEqual([]);
    const [row] = await db.select().from(whatsappLink);
    expect(row.ownerWaId).toBeNull();
  });

  it("links with the one-time code, which then can't be reused", async () => {
    const { sent, sender } = fakeSender();
    const code = await createLinkCode(db);
    await handleInbound(db, text(OWNER, `LINK ${code}`), { sender, origin: "o" });
    expect(sent[0].body).toMatch(/^Linked/);
    // after linking, only the owner is heard
    await handleInbound(db, text(STRANGER, `link ${code}`), { sender, origin: "o" });
    await handleInbound(db, text(STRANGER, "status"), { sender, origin: "o" });
    expect(sent).toHaveLength(1);
  });

  it("an expired code does not link", async () => {
    const { sent, sender } = fakeSender();
    const code = await createLinkCode(db);
    await handleInbound(db, text(OWNER, `link ${code}`), { sender, origin: "o", now: new Date(Date.now() + 11 * 60_000) });
    expect(sent).toEqual([]);
  });
});

describe("commands and approvals", () => {
  it("answers status for the owner", async () => {
    const { sent, sender } = fakeSender();
    await linkOwner(sender);
    await handleInbound(db, text(OWNER, "status"), { sender, origin: "o" });
    expect(sent.at(-1)!.body).toContain("Pending approvals: 0");
  });

  it("approves a Low-risk proposal from a button bound to its hash", async () => {
    const { sent, sender } = fakeSender();
    await linkOwner(sender);
    const p = await createProposal(db, { ...fields, actionType: "system.test_approval", operation: { note: "n" } });
    await handleInbound(db, button(OWNER, approveButtonId(p)), { sender, origin: "o" });
    expect(sent.at(-1)!.body).toMatch(/^Approved/);
    expect((await db.select().from(proposals).where(eq(proposals.id, p.id)))[0].status).toBe("approved");
  });

  it("refuses a button carrying a different operation hash", async () => {
    const { sent, sender } = fakeSender();
    await linkOwner(sender);
    const p = await createProposal(db, { ...fields, actionType: "system.test_approval", operation: { note: "n" } });
    await handleInbound(db, button(OWNER, `ap:${p.id}:000000000000`), { sender, origin: "o" });
    expect(sent.at(-1)!.body).toMatch(/out of date/);
    expect((await db.select().from(proposals))[0].status).toBe("pending");
  });

  it("refuses Medium-risk approval over WhatsApp", async () => {
    const { sent, sender } = fakeSender();
    await linkOwner(sender);
    const p = await createProposal(db, {
      ...fields, actionType: "github.merge_pull_request",
      operation: { repository: "a/b", pullNumber: 1, headSha: "c".repeat(40), mergeMethod: "squash" },
    });
    await handleInbound(db, button(OWNER, approveButtonId(p)), { sender, origin: "o" });
    expect(sent.at(-1)!.body).toMatch(/dashboard/);
    expect((await db.select().from(proposals))[0].status).toBe("pending");
  });

  it("a stranger's button press does nothing", async () => {
    const { sent, sender } = fakeSender();
    await linkOwner(sender);
    const p = await createProposal(db, { ...fields, actionType: "system.test_approval", operation: { note: "n" } });
    const before = sent.length;
    await handleInbound(db, button(STRANGER, approveButtonId(p)), { sender, origin: "o" });
    await handleInbound(db, button(STRANGER, rejectButtonId(p)), { sender, origin: "o" });
    expect(sent.length).toBe(before);
    expect((await db.select().from(proposals))[0].status).toBe("pending");
  });
});

describe("24-hour window", () => {
  it("sends free-form inside the window and a template outside it", async () => {
    const { sent, sender } = fakeSender();
    await linkOwner(sender);
    expect(await notifyOwner(db, sender, { text: "Build failed", link: "https://x" })).toBe("sent");
    await db.update(whatsappLink).set({ lastInboundAt: new Date(Date.now() - 25 * 3600_000) });
    expect(await notifyOwner(db, sender, { text: "Build\nfailed", link: "https://x" })).toBe("sent_template");
    expect(sent.at(-1)).toMatchObject({ kind: "template", body: "nova_alert" });
  });

  it("makes template parameters safe", () => {
    expect(templateSafe("a\nb\tc      d")).toBe("a b c   d");
  });
});
