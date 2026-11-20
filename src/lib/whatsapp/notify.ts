import type { Db } from "@/db/types";
import { appendAudit } from "@/lib/audit";
import { whatsappConfig } from "@/lib/env";
import { ACTIONS, isKnownAction } from "@/lib/approvals/registry";
import type { Button, WhatsAppSender } from "./api";
import { getLink } from "./link";

/** Meta's customer-service window is 24h; keep a 10-minute safety margin. */
const WINDOW_MS = 24 * 60 * 60 * 1000 - 10 * 60 * 1000;

export type NotifyResult = "sent" | "sent_template" | "not_linked" | "not_configured" | "failed";

export function windowOpen(lastInboundAt: Date | null | undefined, now = new Date()) {
  return !!lastInboundAt && now.getTime() - lastInboundAt.getTime() < WINDOW_MS;
}

/**
 * Sends a short alert to the owner. Inside the 24-hour window it sends free-form text (and buttons, if any).
 * Outside it, it falls back to the approved utility template, which carries the summary and a link.
 */
export async function notifyOwner(
  db: Db,
  sender: WhatsAppSender,
  msg: { text: string; link?: string; buttons?: Button[] },
): Promise<NotifyResult> {
  const cfg = whatsappConfig();
  if (!cfg) return "not_configured";
  const link = await getLink(db);
  if (!link?.ownerWaId) return "not_linked";
  const to = link.ownerWaId;
  const url = msg.link ?? cfg.origin;
  try {
    if (windowOpen(link.lastInboundAt)) {
      const body = `${msg.text}\n${url}`;
      if (msg.buttons?.length) await sender.buttons(to, body, msg.buttons);
      else await sender.text(to, body);
      return "sent";
    }
    await sender.template(to, cfg.alertTemplate, cfg.templateLanguage, [msg.text, url]);
    return "sent_template";
  } catch (e) {
    await appendAudit(db, {
      actor: "system",
      event: "whatsapp.send_failed",
      details: { error: e instanceof Error ? e.message : String(e) },
    });
    return "failed";
  }
}

type ProposalLike = {
  id: string;
  actionType: string;
  riskLevel: string;
  target: string;
  reason: string;
  opHash: string;
};

export const approveButtonId = (p: { id: string; opHash: string }) => `ap:${p.id}:${p.opHash.slice(0, 12)}`;
export const rejectButtonId = (p: { id: string }) => `rj:${p.id}`;

/** Approval request on WhatsApp. Only Low-risk proposals get buttons; others point to the dashboard. */
export async function notifyProposal(db: Db, sender: WhatsAppSender, p: ProposalLike) {
  const cfg = whatsappConfig();
  const title = isKnownAction(p.actionType) ? ACTIONS[p.actionType].title : p.actionType;
  const low = p.riskLevel === "low";
  const text =
    `Approval needed (${p.riskLevel} risk): ${title}. Target: ${p.target}. Reason: ${p.reason}` +
    (low ? "" : " Approve on the dashboard with your passkey.");
  return notifyOwner(db, sender, {
    text,
    link: `${cfg?.origin ?? ""}/approvals`,
    buttons: low
      ? [
          { id: approveButtonId(p), title: "Approve" },
          { id: rejectButtonId(p), title: "Reject" },
        ]
      : undefined,
  });
}
