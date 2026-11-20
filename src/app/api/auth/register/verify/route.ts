import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { db } from "@/db";
import { passkeys, users } from "@/db/schema";
import { appendAudit } from "@/lib/audit";
import { createSession, getSession } from "@/lib/auth/session";
import { takeChallenge } from "@/lib/auth/webauthn";
import { env } from "@/lib/env";
import { forbidden, json, sameOrigin } from "@/lib/http";

const body = z.object({
  challengeId: z.string().uuid(),
  label: z.string().max(60).optional(),
  response: z.custom<RegistrationResponseJSON>((v) => typeof v === "object" && v !== null),
});

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const input = body.safeParse(await req.json().catch(() => null));
  if (!input.success) return json({ error: "Bad request." }, 400);

  const existing = await db().select({ id: passkeys.id }).from(passkeys);
  const session = await getSession();
  const [owner] = await db().select().from(users).limit(1);
  if (!owner) return forbidden();
  if (existing.length > 0 && session?.userId !== owner.id) return forbidden();

  const challenge = await takeChallenge(input.data.challengeId, `register:${owner.id}`);
  if (!challenge) return json({ error: "Challenge expired. Try again." }, 400);

  const { NOVA_ORIGIN, NOVA_RP_ID } = env();
  const result = await verifyRegistrationResponse({
    response: input.data.response,
    expectedChallenge: challenge,
    expectedOrigin: NOVA_ORIGIN,
    expectedRPID: NOVA_RP_ID,
    requireUserVerification: true,
  }).catch(() => null);
  if (!result?.verified || !result.registrationInfo) return json({ error: "Passkey could not be verified." }, 400);

  const { credential } = result.registrationInfo;
  await db()
    .insert(passkeys)
    .values({
      id: credential.id,
      userId: owner.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports ?? null,
      label: input.data.label ?? null,
    });
  await appendAudit(db(), {
    actor: "owner",
    event: existing.length === 0 ? "auth.owner_setup" : "auth.passkey_added",
    details: { label: input.data.label ?? "" },
  });
  if (!session) await createSession(owner.id);
  return json({ ok: true });
}
