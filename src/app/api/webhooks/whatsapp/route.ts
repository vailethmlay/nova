import { timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { chat } from "@/lib/chat";
import { whatsappConfig } from "@/lib/env";
import { logger } from "@/lib/logger";
import { firstDelivery } from "@/lib/webhooks";
import { metaSender } from "@/lib/whatsapp/api";
import { handleInbound, type InboundMessage } from "@/lib/whatsapp/inbound";
import { verifyMetaSignature } from "@/lib/whatsapp/signature";

/** Meta's one-time subscription check. */
export async function GET(req: Request) {
  const cfg = whatsappConfig();
  if (!cfg) return new Response("WhatsApp not configured", { status: 503 });
  const q = new URL(req.url).searchParams;
  const given = Buffer.from(q.get("hub.verify_token") ?? "");
  const expected = Buffer.from(cfg.verifyToken);
  if (q.get("hub.mode") === "subscribe" && given.length === expected.length && timingSafeEqual(given, expected)) {
    return new Response(q.get("hub.challenge") ?? "", { headers: { "content-type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

type Payload = { entry?: Array<{ changes?: Array<{ value?: { messages?: InboundMessage[] } }> }> };

export async function POST(req: Request) {
  const cfg = whatsappConfig();
  if (!cfg) return new Response("WhatsApp not configured", { status: 503 });
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), cfg.appSecret)) {
    return new Response("Bad signature", { status: 401 });
  }
  const payload = JSON.parse(raw) as Payload;
  const messages = (payload.entry ?? []).flatMap((e) => (e.changes ?? []).flatMap((c) => c.value?.messages ?? []));
  for (const m of messages) {
    if (!(await firstDelivery(db(), `whatsapp:${m.id}`))) continue;
    try {
      await handleInbound(db(), m, {
        sender: metaSender,
        origin: cfg.origin,
        ask: (q) => chat(q, null),
      });
    } catch (e) {
      logger.error({ err: e instanceof Error ? e.message : String(e) }, "whatsapp inbound failed");
    }
  }
  // Always 200 after a valid signature so Meta doesn't retry messages we've already handled.
  return new Response("ok");
}
