import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { approvals, proposals } from "@/db/schema";
import type { Db } from "@/db/types";
import { appendAudit } from "@/lib/audit";
import { operationHash } from "@/lib/canonical";
import { ACTIONS, PROHIBITED_ACTIONS, isKnownAction, type RiskLevel } from "./registry";

export const APPROVAL_TTL_MS = 30 * 60 * 1000;
const RISK_ORDER: RiskLevel[] = ["low", "medium", "high"];

export class ApprovalError extends Error {
  constructor(
    public code:
      | "prohibited"
      | "unknown_action"
      | "invalid_operation"
      | "not_found"
      | "not_pending"
      | "channel_not_allowed"
      | "operation_changed"
      | "no_valid_approval"
      | "no_executor",
    message: string,
  ) {
    super(message);
    this.name = "ApprovalError";
  }
}

const proposalInput = z.object({
  actionType: z.string().min(1),
  operation: z.unknown(),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
  applicationId: z.string().uuid().nullish(),
  // The eight things every approval request must show (brief section 7):
  // 1 proposed action = actionType title, 8 exact operation = operation; the rest are below.
  reason: z.string().trim().min(1),
  target: z.string().trim().min(1),
  affected: z.string().trim().min(1),
  consequences: z.string().trim().min(1),
  risks: z.string().trim().min(1),
  rollback: z.string().trim().min(1),
  proposedBy: z.enum(["nova", "owner"]),
});
export type ProposalInput = z.input<typeof proposalInput>;

/** Creates an immutable proposal. To change it, create a new one: it gets a new hash and needs a new approval. */
export async function createProposal(db: Db, raw: ProposalInput) {
  const input = proposalInput.parse(raw);

  if (PROHIBITED_ACTIONS.has(input.actionType)) {
    await appendAudit(db, {
      actor: input.proposedBy,
      event: "action.refused_prohibited",
      details: { actionType: input.actionType, reason: input.reason },
    });
    throw new ApprovalError("prohibited", `${input.actionType} is a prohibited (Category 3) action.`);
  }
  if (!isKnownAction(input.actionType)) {
    await appendAudit(db, {
      actor: input.proposedBy,
      event: "action.refused_unknown",
      details: { actionType: input.actionType },
    });
    throw new ApprovalError("unknown_action", `Unknown action type: ${input.actionType}`);
  }

  const def = ACTIONS[input.actionType];
  const parsed = def.operation.safeParse(input.operation);
  if (!parsed.success) {
    throw new ApprovalError("invalid_operation", parsed.error.issues.map((i) => i.message).join("; "));
  }
  // A proposer may raise the risk level, never lower it below the action's default.
  const requested = input.riskLevel ?? def.defaultRisk;
  const riskLevel = RISK_ORDER[Math.max(RISK_ORDER.indexOf(requested), RISK_ORDER.indexOf(def.defaultRisk))];
  const opHash = operationHash(input.actionType, parsed.data);

  const [row] = await db
    .insert(proposals)
    .values({
      actionType: input.actionType,
      category: def.category,
      riskLevel,
      applicationId: input.applicationId ?? null,
      reason: input.reason,
      target: input.target,
      affected: input.affected,
      consequences: input.consequences,
      risks: input.risks,
      rollback: input.rollback,
      operation: parsed.data,
      opHash,
      proposedBy: input.proposedBy,
    })
    .returning();

  await appendAudit(db, {
    actor: input.proposedBy,
    event: "proposal.created",
    proposalId: row.id,
    details: { actionType: row.actionType, riskLevel, opHash, target: row.target },
  });
  return row;
}

type Decision = {
  proposalId: string;
  userId: string;
  channel: "dashboard" | "whatsapp";
  now?: Date;
};

/**
 * Grants an approval bound to the proposal's exact operation hash, valid for 30 minutes, usable once.
 * The caller must already have verified the owner (dashboard: a fresh passkey assertion).
 */
export async function approveProposal(db: Db, d: Decision) {
  const now = d.now ?? new Date();
  const approval = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(proposals).where(eq(proposals.id, d.proposalId)).for("update");
    if (!p) throw new ApprovalError("not_found", "Proposal not found.");
    if (p.status !== "pending") throw new ApprovalError("not_pending", `Proposal is ${p.status}, not pending.`);
    if (d.channel === "whatsapp" && p.riskLevel !== "low") {
      throw new ApprovalError("channel_not_allowed", "Medium and High risk actions must be approved on the dashboard.");
    }
    const [a] = await tx
      .insert(approvals)
      .values({
        proposalId: p.id,
        opHash: p.opHash,
        approvedBy: d.userId,
        channel: d.channel,
        expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS),
      })
      .returning();
    await tx.update(proposals).set({ status: "approved", decidedAt: now }).where(eq(proposals.id, p.id));
    return a;
  });
  await appendAudit(db, {
    actor: "owner",
    event: "approval.granted",
    proposalId: d.proposalId,
    details: { channel: d.channel, opHash: approval.opHash, expiresAt: approval.expiresAt.toISOString() },
  });
  return approval;
}

export async function rejectProposal(db: Db, d: Decision & { note?: string }) {
  const now = d.now ?? new Date();
  const updated = await db
    .update(proposals)
    .set({ status: "rejected", decidedAt: now })
    .where(and(eq(proposals.id, d.proposalId), eq(proposals.status, "pending")))
    .returning();
  if (updated.length === 0) throw new ApprovalError("not_pending", "Proposal is not pending.");
  await appendAudit(db, {
    actor: "owner",
    event: "approval.rejected",
    proposalId: d.proposalId,
    details: { channel: d.channel, note: d.note ?? "" },
  });
}

/**
 * Called by the executor immediately before acting, with the operation as it stands *now*
 * (e.g. the live PR head SHA). Consumes the approval atomically, so it can never be used twice.
 */
export async function consumeApproval(
  db: Db,
  args: { proposalId: string; actionType: string; liveOperation: unknown; now?: Date },
) {
  const now = args.now ?? new Date();
  const [p] = await db.select().from(proposals).where(eq(proposals.id, args.proposalId));
  if (!p) throw new ApprovalError("not_found", "Proposal not found.");

  const block = async (code: "operation_changed" | "no_valid_approval", message: string) => {
    await appendAudit(db, {
      actor: "executor",
      event: "execution.blocked",
      proposalId: p.id,
      details: { code, message },
    });
    return new ApprovalError(code, message);
  };

  if (!isKnownAction(args.actionType) || args.actionType !== p.actionType) {
    throw await block("operation_changed", "Action type differs from the approved proposal.");
  }
  const parsed = ACTIONS[args.actionType].operation.safeParse(args.liveOperation);
  if (!parsed.success || operationHash(args.actionType, parsed.data) !== p.opHash) {
    throw await block("operation_changed", "The operation changed since it was approved. A new approval is required.");
  }

  const used = await db
    .update(approvals)
    .set({ usedAt: now })
    .where(
      and(
        eq(approvals.proposalId, p.id),
        eq(approvals.opHash, p.opHash),
        isNull(approvals.usedAt),
        gt(approvals.expiresAt, now),
      ),
    )
    .returning();
  if (used.length === 0) {
    throw await block("no_valid_approval", "No unused, unexpired approval exists for this exact operation.");
  }

  await db.update(proposals).set({ status: "executing" }).where(eq(proposals.id, p.id));
  await appendAudit(db, {
    actor: "executor",
    event: "execution.authorized",
    proposalId: p.id,
    details: { approvalId: used[0].id, opHash: p.opHash },
  });
  return { proposal: p, operation: parsed.data, approval: used[0] };
}

export async function recordExecutionResult(
  db: Db,
  proposalId: string,
  result: { ok: boolean; details?: Record<string, unknown> },
) {
  await db
    .update(proposals)
    .set({ status: result.ok ? "executed" : "failed" })
    .where(eq(proposals.id, proposalId));
  await appendAudit(db, {
    actor: "executor",
    event: result.ok ? "execution.succeeded" : "execution.failed",
    proposalId,
    details: result.details ?? {},
  });
}
