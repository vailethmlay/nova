import { generateAuthenticationOptions, type AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { db } from "@/db";
import { passkeys } from "@/db/schema";
import { storeChallenge } from "@/lib/auth/webauthn";
import { env } from "@/lib/env";
import { forbidden, json, sameOrigin } from "@/lib/http";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const keys = await db().select().from(passkeys);
  if (keys.length === 0) return json({ setupRequired: true });
  const options = await generateAuthenticationOptions({
    rpID: env().NOVA_RP_ID,
    userVerification: "required",
    allowCredentials: keys.map((k) => ({
      id: k.id,
      transports: (k.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    })),
  });
  return json({ challengeId: await storeChallenge(options.challenge, "login"), options });
}
