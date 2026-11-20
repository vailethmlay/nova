import { verify } from "@octokit/webhooks-methods";
import { db } from "@/db";
import { githubConfig } from "@/lib/env";
import { applyGithubEvent } from "@/lib/github/events";
import { logger } from "@/lib/logger";
import { firstDelivery } from "@/lib/webhooks";
import { metaSender } from "@/lib/whatsapp/api";
import { notifyOwner } from "@/lib/whatsapp/notify";

/** GitHub App webhook. Signature-checked, de-duplicated, read-only: it only updates NOVA's mirror and may alert. */
export async function POST(req: Request) {
  const cfg = githubConfig();
  if (!cfg) return new Response("GitHub not configured", { status: 503 });
  const raw = await req.text();
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  if (!(await verify(cfg.webhookSecret, raw, sig).catch(() => false))) {
    return new Response("Bad signature", { status: 401 });
  }
  const event = req.headers.get("x-github-event") ?? "";
  const delivery = req.headers.get("x-github-delivery") ?? "";
  if (!delivery || !(await firstDelivery(db(), `github:${delivery}`))) return new Response("ok");

  try {
    const alerts = await applyGithubEvent(db(), event, JSON.parse(raw));
    for (const a of alerts) {
      // Builds failing on the default branch are critical; PRs and releases are informational.
      await notifyOwner(db(), metaSender, { text: a.text, link: a.url });
    }
  } catch (e) {
    logger.error({ event, err: e instanceof Error ? e.message : String(e) }, "github webhook failed");
    return new Response("error", { status: 500 }); // GitHub will show the failed delivery for redelivery
  }
  return new Response("ok");
}
