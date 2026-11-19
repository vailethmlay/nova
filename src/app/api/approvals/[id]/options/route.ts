import { generateAuthenticationOptions, type AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { db } from "@/db";
import { passkeys } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { storeChallenge } from "@/lib/auth/webauthn";
import { env } from "@/lib/env";
import { forbidden, json, sameOrigin } from "@/lib/http";

/** A passkey challenge bound to one proposal: an assertion for proposal A can't approve proposal B. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req) || !(await getSession())) return forbidden();
  const { id } = await ctx.params;
  const keys = await db().select().from(passkeys);
  const options = await generateAuthenticationOptions({
    rpID: env().NOVA_RP_ID,
    userVerification: "required",
    allowCredentials: keys.map((k) => ({
      id: k.id,
      transports: (k.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    })),
  });
  return json({ challengeId: await storeChallenge(options.challenge, `approve:${id}`), options });
}
