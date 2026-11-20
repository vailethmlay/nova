import { eq } from "drizzle-orm";
import { proposals } from "@/db/schema";
import type { Db } from "@/db/types";
import { appendAudit } from "@/lib/audit";
import { ApprovalError, consumeApproval, recordExecutionResult } from "./engine";
import type { ActionType } from "./registry";

/**
 * Executors are the only code allowed to change anything outside NOVA.
 * Each one first re-reads live state to build the operation it is about to run,
 * then must pass consumeApproval with it.
 *
 * Phase 1 ships only the no-op test executor. GitHub write executors arrive in Phase 4,
 * in a separate process that alone holds the write-capable token.
 */
type Executor = {
  liveOperation: (stored: unknown) => Promise<unknown>;
  run: (db: Db, proposalId: string, operation: unknown) => Promise<Record<string, unknown>>;
};

const EXECUTORS: Partial<Record<ActionType, Executor>> = {
  "system.test_approval": {
    liveOperation: async (stored) => stored,
    run: async (db, proposalId, operation) => {
      await appendAudit(db, { actor: "executor", event: "test_action.ran", proposalId, details: { operation } });
      return { effect: "none" };
    },
  },
};

export async function executeProposal(db: Db, proposalId: string) {
  const [p] = await db.select().from(proposals).where(eq(proposals.id, proposalId));
  if (!p) throw new ApprovalError("not_found", "Proposal not found.");
  const executor = EXECUTORS[p.actionType as ActionType];
  if (!executor) {
    await appendAudit(db, {
      actor: "executor",
      event: "execution.blocked",
      proposalId,
      details: { code: "no_executor", actionType: p.actionType },
    });
    throw new ApprovalError("no_executor", `No executor is installed for ${p.actionType} yet.`);
  }
  const live = await executor.liveOperation(p.operation);
  const { operation } = await consumeApproval(db, { proposalId, actionType: p.actionType, liveOperation: live });
  try {
    const details = await executor.run(db, proposalId, operation);
    await recordExecutionResult(db, proposalId, { ok: true, details });
    return { ok: true as const, details };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordExecutionResult(db, proposalId, { ok: false, details: { error: message } });
    return { ok: false as const, error: message };
  }
}
