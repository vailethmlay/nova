import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { db } from "@/db";
import { appendAudit } from "@/lib/audit";
import { createSession } from "@/lib/auth/session";
import { verifyAssertion } from "@/lib/auth/webauthn";
import { forbidden, json, sameOrigin } from "@/lib/http";

const body = z.object({
  challengeId: z.string().uuid(),
  response: z.custom<AuthenticationResponseJSON>((v) => typeof v === "object" && v !== null),
});

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const input = body.safeParse(await req.json().catch(() => null));
  if (!input.success) return json({ error: "Bad request." }, 400);
  const who = await verifyAssertion(input.data.challengeId, "login", input.data.response);
  if (!who) {
    await appendAudit(db(), { actor: "system", event: "auth.login_failed", details: {} });
    return json({ error: "Sign-in failed." }, 401);
  }
  await createSession(who.userId);
  await appendAudit(db(), { actor: "owner", event: "auth.login", details: {} });
  return json({ ok: true });
}
