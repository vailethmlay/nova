import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { db } from "@/db";
import { authChallenges, passkeys } from "@/db/schema";
import { env } from "@/lib/env";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export async function storeChallenge(challenge: string, purpose: string) {
  const [row] = await db()
    .insert(authChallenges)
    .values({ challenge, purpose, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) })
    .returning({ id: authChallenges.id });
  return row.id;
}

/** Returns the challenge once; any later call for the same id returns null. */
export async function takeChallenge(id: string, purpose: string) {
  const [row] = await db()
    .update(authChallenges)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authChallenges.id, id),
        eq(authChallenges.purpose, purpose),
        isNull(authChallenges.usedAt),
        gt(authChallenges.expiresAt, new Date()),
      ),
    )
    .returning({ challenge: authChallenges.challenge });
  return row?.challenge ?? null;
}

/** Verifies a passkey assertion for a specific purpose (login, or approving one proposal). */
export async function verifyAssertion(challengeId: string, purpose: string, response: AuthenticationResponseJSON) {
  const challenge = await takeChallenge(challengeId, purpose);
  if (!challenge) return null;
  const [pk] = await db().select().from(passkeys).where(eq(passkeys.id, response.id));
  if (!pk) return null;
  const { NOVA_ORIGIN, NOVA_RP_ID } = env();
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: NOVA_ORIGIN,
    expectedRPID: NOVA_RP_ID,
    requireUserVerification: true,
    credential: {
      id: pk.id,
      publicKey: Buffer.from(pk.publicKey, "base64url"),
      counter: pk.counter,
      transports: (pk.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    },
  }).catch(() => null);
  if (!result?.verified) return null;
  await db()
    .update(passkeys)
    .set({ counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(passkeys.id, pk.id));
  return { userId: pk.userId, passkeyId: pk.id };
}
