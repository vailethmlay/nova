"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { createProposal, rejectProposal } from "@/lib/approvals/engine";
import { requireSession } from "@/lib/auth/session";
import { metaSender } from "@/lib/whatsapp/api";
import { notifyProposal } from "@/lib/whatsapp/notify";

export async function rejectAction(form: FormData) {
  const session = await requireSession();
  const id = z.string().uuid().parse(form.get("id"));
  await rejectProposal(db(), { proposalId: id, userId: session.userId, channel: "dashboard" }).catch(() => {});
  revalidatePath("/approvals");
}

/** Creates a harmless proposal so the owner can try the full approval loop. */
export async function createTestProposal() {
  await requireSession();
  const p = await createProposal(db(), {
    actionType: "system.test_approval",
    operation: { note: `Test created ${new Date().toISOString()}` },
    reason: "Check that the approval workflow works end to end.",
    target: "NOVA itself",
    affected: "Audit log only",
    consequences: "None. The executor only writes an audit entry.",
    risks: "None.",
    rollback: "Nothing to roll back.",
    proposedBy: "owner",
  });
  await notifyProposal(db(), metaSender, p); // no-op until WhatsApp is configured and linked
  revalidatePath("/approvals");
}
