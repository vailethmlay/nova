import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { approvals, auditLog } from "@/db/schema";
import type { Db } from "@/db/types";
import {
  ApprovalError,
  APPROVAL_TTL_MS,
  approveProposal,
  consumeApproval,
  createProposal,
  rejectProposal,
} from "@/lib/approvals/engine";
import { executeProposal } from "@/lib/approvals/executor";
import { verifyAuditChain } from "@/lib/audit";
import { testDb } from "./helpers";

const fields = {
  reason: "Feature is complete and reviewed",
  target: "acme/myaida",
  affected: "src/payments/*",
  consequences: "Code lands on main and deploys",
  risks: "Regression in payments",
  rollback: "Revert the merge commit",
  proposedBy: "nova" as const,
};
const mergeOp = {
  repository: "acme/myaida",
  pullNumber: 42,
  headSha: "a".repeat(40),
  mergeMethod: "squash" as const,
};

let db: Db;
let ownerId: string;

beforeEach(async () => {
  const t = await testDb();
  db = t.db;
  ownerId = t.owner.id;
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApprovalError) return e.code;
    throw e;
  }
  return "no_error";
};

describe("proposals", () => {
  it("refuses Category 3 actions and audits the attempt", async () => {
    expect(await code(createProposal(db, { ...fields, actionType: "github.delete_repository", operation: {} }))).toBe(
      "prohibited",
    );
    const rows = await db.select().from(auditLog);
    expect(rows.map((r) => r.event)).toEqual(["action.refused_prohibited"]);
  });

  it("refuses unknown actions and invalid operations", async () => {
    expect(await code(createProposal(db, { ...fields, actionType: "shell.exec", operation: {} }))).toBe(
      "unknown_action",
    );
    expect(
      await code(
        createProposal(db, {
          ...fields,
          actionType: "github.merge_pull_request",
          operation: { ...mergeOp, headSha: "short" },
        }),
      ),
    ).toBe("invalid_operation");
    expect(
      await code(
        createProposal(db, {
          ...fields,
          actionType: "github.merge_pull_request",
          operation: { ...mergeOp, extra: "field" },
        }),
      ),
    ).toBe("invalid_operation");
  });

  it("never lowers risk below the action default", async () => {
    const p = await createProposal(db, {
      ...fields,
      actionType: "github.merge_pull_request",
      operation: mergeOp,
      riskLevel: "low",
    });
    expect(p.riskLevel).toBe("medium");
  });

  it("requires all approval-request fields", async () => {
    await expect(
      createProposal(db, { ...fields, rollback: " ", actionType: "system.test_approval", operation: { note: "x" } }),
    ).rejects.toThrow();
  });
});

describe("approvals", () => {
  it("binds to the exact operation: a changed operation is blocked", async () => {
    const p = await createProposal(db, { ...fields, actionType: "github.merge_pull_request", operation: mergeOp });
    await approveProposal(db, { proposalId: p.id, userId: ownerId, channel: "dashboard" });
    // A new commit was pushed after approval.
    expect(
      await code(
        consumeApproval(db, {
          proposalId: p.id,
          actionType: p.actionType,
          liveOperation: { ...mergeOp, headSha: "b".repeat(40) },
        }),
      ),
    ).toBe("operation_changed");
    // The approval was not consumed by the blocked attempt, so the exact op still passes.
    const ok = await consumeApproval(db, { proposalId: p.id, actionType: p.actionType, liveOperation: mergeOp });
    expect(ok.approval.usedAt).not.toBeNull();
  });

  it("key order in the operation does not matter", async () => {
    const p = await createProposal(db, { ...fields, actionType: "github.merge_pull_request", operation: mergeOp });
    await approveProposal(db, { proposalId: p.id, userId: ownerId, channel: "dashboard" });
    const reordered = { mergeMethod: "squash", headSha: mergeOp.headSha, pullNumber: 42, repository: "acme/myaida" };
    await expect(
      consumeApproval(db, { proposalId: p.id, actionType: p.actionType, liveOperation: reordered }),
    ).resolves.toBeTruthy();
  });

  it("is single-use", async () => {
    const p = await createProposal(db, { ...fields, actionType: "github.merge_pull_request", operation: mergeOp });
    await approveProposal(db, { proposalId: p.id, userId: ownerId, channel: "dashboard" });
    await consumeApproval(db, { proposalId: p.id, actionType: p.actionType, liveOperation: mergeOp });
    expect(
      await code(consumeApproval(db, { proposalId: p.id, actionType: p.actionType, liveOperation: mergeOp })),
    ).toBe("no_valid_approval");
  });

  it("expires after 30 minutes", async () => {
    const p = await createProposal(db, { ...fields, actionType: "github.merge_pull_request", operation: mergeOp });
    const t0 = new Date("2026-11-19T09:00:00Z");
    await approveProposal(db, { proposalId: p.id, userId: ownerId, channel: "dashboard", now: t0 });
    const late = new Date(t0.getTime() + APPROVAL_TTL_MS + 1000);
    expect(
      await code(
        consumeApproval(db, { proposalId: p.id, actionType: p.actionType, liveOperation: mergeOp, now: late }),
      ),
    ).toBe("no_valid_approval");
  });

  it("cannot approve twice, or approve after rejection", async () => {
    const p = await createProposal(db, { ...fields, actionType: "system.test_approval", operation: { note: "a" } });
    await approveProposal(db, { proposalId: p.id, userId: ownerId, channel: "dashboard" });
    expect(await code(approveProposal(db, { proposalId: p.id, userId: ownerId, channel: "dashboard" }))).toBe(
      "not_pending",
    );
    const q = await createProposal(db, { ...fields, actionType: "system.test_approval", operation: { note: "b" } });
    await rejectProposal(db, { proposalId: q.id, userId: ownerId, channel: "dashboard" });
    expect(await code(approveProposal(db, { proposalId: q.id, userId: ownerId, channel: "dashboard" }))).toBe(
      "not_pending",
    );
    expect(await db.select().from(approvals)).toHaveLength(1);
  });

  it("WhatsApp can approve Low risk only", async () => {
    const p = await createProposal(db, { ...fields, actionType: "github.merge_pull_request", operation: mergeOp });
    expect(await code(approveProposal(db, { proposalId: p.id, userId: ownerId, channel: "whatsapp" }))).toBe(
      "channel_not_allowed",
    );
    const q = await createProposal(db, { ...fields, actionType: "system.test_approval", operation: { note: "x" } });
    await expect(approveProposal(db, { proposalId: q.id, userId: ownerId, channel: "whatsapp" })).resolves.toBeTruthy();
  });

  it("there is no execution without approval", async () => {
    const p = await createProposal(db, { ...fields, actionType: "system.test_approval", operation: { note: "x" } });
    expect(await code(executeProposal(db, p.id))).toBe("no_valid_approval");
  });

  it("actions without an executor cannot run even when approved", async () => {
    const p = await createProposal(db, { ...fields, actionType: "github.merge_pull_request", operation: mergeOp });
    await approveProposal(db, { proposalId: p.id, userId: ownerId, channel: "dashboard" });
    expect(await code(executeProposal(db, p.id))).toBe("no_executor");
  });

  it("runs the full test loop and leaves a valid audit chain", async () => {
    const p = await createProposal(db, { ...fields, actionType: "system.test_approval", operation: { note: "hi" } });
    await approveProposal(db, { proposalId: p.id, userId: ownerId, channel: "dashboard" });
    const result = await executeProposal(db, p.id);
    expect(result.ok).toBe(true);
    const events = (await db.select().from(auditLog)).map((r) => r.event);
    expect(events).toEqual([
      "proposal.created",
      "approval.granted",
      "execution.authorized",
      "test_action.ran",
      "execution.succeeded",
    ]);
    expect(await verifyAuditChain(db)).toEqual({ ok: true, entries: 5 });
  });
});

describe("audit log", () => {
  it("rejects UPDATE and DELETE at the database level", async () => {
    await createProposal(db, { ...fields, actionType: "system.test_approval", operation: { note: "x" } });
    const cause = (p: Promise<unknown>) =>
      p.then(
        () => "no error",
        (e: { cause?: { message?: string } }) => e.cause?.message ?? String(e),
      );
    expect(await cause(db.execute(sql`update audit_log set actor = 'x'`))).toMatch(/append-only/);
    expect(await cause(db.execute(sql`delete from audit_log`))).toMatch(/append-only/);
  });

  it("redacts secrets in details", async () => {
    await createProposal(db, {
      ...fields,
      reason: "token ghp_abcdefghijklmnopqrstuvwxyz0123 leaked",
      actionType: "credentials.share",
      operation: {},
    }).catch(() => {});
    const [row] = await db.select().from(auditLog);
    expect(JSON.stringify(row.details)).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123");
  });
});
