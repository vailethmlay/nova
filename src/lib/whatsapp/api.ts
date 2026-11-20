import { whatsappConfig } from "@/lib/env";

/** Thin client for Meta's WhatsApp Cloud API. Only summaries and links are ever sent: never code or secrets. */
export type Button = { id: string; title: string };
export type WhatsAppSender = {
  text(to: string, body: string): Promise<void>;
  buttons(to: string, body: string, buttons: Button[]): Promise<void>;
  template(to: string, name: string, language: string, params: string[]): Promise<void>;
};

async function call(payload: Record<string, unknown>) {
  const cfg = whatsappConfig();
  if (!cfg) throw new Error("WhatsApp is not configured.");
  const res = await fetch(`https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } };
    throw new Error(`WhatsApp API ${res.status}: ${err.error?.message ?? "request failed"} (code ${err.error?.code ?? "?"})`);
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const metaSender: WhatsAppSender = {
  text: (to, body) => call({ to, type: "text", text: { preview_url: false, body: clip(body, 4096) } }),
  buttons: (to, body, buttons) =>
    call({
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: clip(body, 1024) },
        action: {
          // Meta allows up to 3 reply buttons, titles up to 20 characters.
          buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: clip(b.title, 20) } })),
        },
      },
    }),
  template: (to, name, language, params) =>
    call({
      to,
      type: "template",
      template: {
        name,
        language: { code: language },
        components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: templateSafe(p) })) }],
      },
    }),
};

/** Template parameters may not contain newlines, tabs or more than 4 consecutive spaces. */
export function templateSafe(s: string) {
  return clip(s.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim(), 900);
}
