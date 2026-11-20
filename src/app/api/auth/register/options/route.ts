import { timingSafeEqual } from "node:crypto";
import { generateRegistrationOptions, type AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { z } from "zod";
import { db } from "@/db";
import { passkeys, users } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { storeChallenge } from "@/lib/auth/webauthn";
import { env } from "@/lib/env";
import { forbidden, json, sameOrigin } from "@/lib/http";

const body = z.object({ setupToken: z.string().optional() });

function tokenMatches(given: string | undefined) {
  const expected = Buffer.from(env().NOVA_SETUP_TOKEN);
  const actual = Buffer.from(given ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * First passkey: allowed only while none exist, and only with NOVA_SETUP_TOKEN.
 * Further passkeys: only from a signed-in session.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const { setupToken } = body.parse(await req.json().catch(() => ({})));
  const existing = await db().select().from(passkeys);
  const session = await getSession();

  let userId: string;
  if (existing.length === 0) {
    if (!tokenMatches(setupToken)) return json({ error: "Invalid setup token." }, 403);
    const [owner] = await db().select().from(users).limit(1);
    userId = owner?.id ?? (await db().insert(users).values({ name: "Owner" }).returning())[0].id;
  } else {
    if (!session) return forbidden();
    userId = session.userId;
  }

  const { NOVA_RP_ID } = env();
  const options = await generateRegistrationOptions({
    rpName: "NOVA",
    rpID: NOVA_RP_ID,
    userName: "owner",
    userDisplayName: "NOVA owner",
    userID: new TextEncoder().encode(userId),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({
      id: p.id,
      transports: (p.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });
  const challengeId = await storeChallenge(options.challenge, `register:${userId}`);
  return json({ challengeId, options });
}
