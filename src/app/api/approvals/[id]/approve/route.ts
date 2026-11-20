import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { db } from "@/db";
import { ApprovalError, approveProposal } from "@/lib/approvals/engine";
import { getSession } from "@/lib/auth/session";
import { verifyAssertion } from "@/lib/auth/webauthn";
import { forbidden, json, sameOrigin } from "@/lib/http";

const body = z.object({
  challengeId: z.string().uuid(),
  response: z.custom<AuthenticationResponseJSON>((v) => typeof v === "object" && v !== null),
});

/** Approval on the dashboard always requires a fresh passkey assertion for this proposal. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!sameOrigin(req) || !session) return forbidden();
  const { id } = await ctx.params;
  const input = body.safeParse(await req.json().catch(() => null));
  if (!input.success) return json({ error: "Bad request." }, 400);

  const who = await verifyAssertion(input.data.challengeId, `approve:${id}`, input.data.response);
  if (!who || who.userId !== session.userId) return json({ error: "Passkey check failed." }, 401);

  try {
    const approval = await approveProposal(db(), { proposalId: id, userId: who.userId, channel: "dashboard" });
    return json({ ok: true, expiresAt: approval.expiresAt });
  } catch (e) {
    if (e instanceof ApprovalError) return json({ error: e.message }, 409);
    throw e;
  }
}
