import { and, count, eq, gt, inArray } from "drizzle-orm";
import { applications, githubRepos, issues, proposals, pullRequests, whatsappLink, workflowRuns } from "@/db/schema";
import type { Db } from "@/db/types";
import { appendAudit } from "@/lib/audit";
import { ApprovalError, approveProposal, rejectProposal } from "@/lib/approvals/engine";
import { users } from "@/db/schema";
import type { WhatsAppSender } from "./api";
import { getLink, tryLink } from "./link";
import { approveButtonId, notifyProposal } from "./notify";

export type InboundMessage = {
  id: string;
  from: string; // sender's WhatsApp id (phone digits)
  type: string;
  text?: { body: string };
  interactive?: { type: string; button_reply?: { id: string; title: string } };
};

type Deps = { sender: WhatsAppSender; ask?: (question: string) => Promise<string>; origin: string; now?: Date };

const HELP =
  "NOVA commands:\n• status — overview of apps, PRs, builds and approvals\n• approvals — what's waiting for you\n• anything else — ask NOVA a question";

export async function statusSummary(db: Db) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const active = db.select({ id: githubRepos.id }).from(githubRepos).where(eq(githubRepos.removed, false));
  const [[apps], [prs], [failed], [iss], [pending]] = await Promise.all([
    db.select({ n: count() }).from(applications),
    db.select({ n: count() }).from(pullRequests).where(and(eq(pullRequests.state, "open"), inArray(pullRequests.repoId, active))),
    db
      .select({ n: count() })
      .from(workflowRuns)
      .where(and(inArray(workflowRuns.conclusion, ["failure", "timed_out", "startup_failure"]), gt(workflowRuns.updatedAtGh, weekAgo), inArray(workflowRuns.repoId, active))),
    db.select({ n: count() }).from(issues).where(and(eq(issues.state, "open"), inArray(issues.repoId, active))),
    db.select({ n: count() }).from(proposals).where(eq(proposals.status, "pending")),
  ]);
  return `NOVA status\n• Applications: ${apps.n}\n• Open PRs: ${prs.n}\n• Failed builds (7 days): ${failed.n}\n• Open issues: ${iss.n}\n• Pending approvals: ${pending.n}\nApp health: not monitored yet.`;
}

/**
 * Handles one inbound WhatsApp message. Anyone other than the linked owner is ignored,
 * except for a valid one-time "link <code>" message while no owner is linked.
 */
export async function handleInbound(db: Db, msg: InboundMessage, deps: Deps) {
  const now = deps.now ?? new Date();
  const link = await getLink(db);
  const text = msg.text?.body?.trim() ?? "";

  if (!link?.ownerWaId) {
    if (text && (await tryLink(db, msg.from, text, now))) {
      await deps.sender.text(msg.from, `Linked. This number now controls NOVA.\n\n${HELP}`);
    }
    return;
  }
  if (msg.from !== link.ownerWaId) {
    await appendAudit(db, { actor: "system", event: "whatsapp.ignored_sender", details: { senderSuffix: msg.from.slice(-4) } });
    return;
  }

  await db.update(whatsappLink).set({ lastInboundAt: now }).where(eq(whatsappLink.id, 1));
  const to = link.ownerWaId;

  const reply = msg.interactive?.button_reply;
  if (reply) {
    const [kind, proposalId, hashPrefix] = reply.id.split(":");
    const [owner] = await db.select().from(users).limit(1);
    try {
      if (kind === "ap") {
        const [p] = await db.select().from(proposals).where(eq(proposals.id, proposalId));
        // The button carries the operation hash it was sent for: a changed proposal can't be approved with an old button.
        if (!p || approveButtonId(p) !== `ap:${proposalId}:${hashPrefix}`) {
          await deps.sender.text(to, "That approval request is out of date. Nothing was approved.");
          return;
        }
        await approveProposal(db, { proposalId, userId: owner.id, channel: "whatsapp", now });
        await deps.sender.text(to, `Approved. Valid for 30 minutes, for that exact operation only.\n${deps.origin}/approvals`);
      } else if (kind === "rj") {
        await rejectProposal(db, { proposalId, userId: owner.id, channel: "whatsapp", now });
        await deps.sender.text(to, "Rejected. Nothing will run.");
      }
    } catch (e) {
      const message = e instanceof ApprovalError ? e.message : "Something went wrong. Nothing was approved.";
      await deps.sender.text(to, message);
    }
    return;
  }

  const lower = text.toLowerCase();
  if (!text || lower === "help") return deps.sender.text(to, HELP);
  if (lower === "status") return deps.sender.text(to, await statusSummary(db));
  if (lower === "approvals") {
    const pending = await db.select().from(proposals).where(eq(proposals.status, "pending")).limit(5);
    if (!pending.length) return deps.sender.text(to, "Nothing is waiting for your approval.");
    for (const p of pending) await notifyProposal(db, deps.sender, p);
    return;
  }
  if (deps.ask) {
    const answer = await deps.ask(text);
    return deps.sender.text(to, `${answer}\n\n${deps.origin}/chat`);
  }
  return deps.sender.text(to, HELP);
}
