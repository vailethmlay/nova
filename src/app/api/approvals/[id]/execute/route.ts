import { db } from "@/db";
import { ApprovalError } from "@/lib/approvals/engine";
import { executeProposal } from "@/lib/approvals/executor";
import { getSession } from "@/lib/auth/session";
import { forbidden, json, sameOrigin } from "@/lib/http";

/** Runs an approved proposal. The executor re-checks the exact operation and consumes the approval. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req) || !(await getSession())) return forbidden();
  const { id } = await ctx.params;
  try {
    return json(await executeProposal(db(), id));
  } catch (e) {
    if (e instanceof ApprovalError) return json({ error: e.message }, 409);
    throw e;
  }
}
