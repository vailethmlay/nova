import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { applications, chatMessages, proposals } from "@/db/schema";
import { env } from "@/lib/env";
import { redact } from "@/lib/redact";
import { appActivity } from "@/lib/github/queries";

const SYSTEM = `You are NOVA, a private operations assistant for one owner who runs several software applications.

How you work:
- You can read, analyse and recommend. You cannot act. You never merge, push, deploy or change anything.
  If an action is needed, say exactly what you would propose, and that it will need the owner's approval in the Approval Center.
- Use only the context given below and the conversation. If something isn't in it, say you don't have that data yet
  (monitoring arrives in Phase 3; GitHub data is only what's listed below). Never invent PRs, builds, metrics or health status.
- Never describe an application as healthy or up without monitoring evidence in the context.
- Be concise. Lead with the answer. Recommend one most important next step rather than many.
- Times are in East Africa Time (EAT).`;

async function buildContext(applicationId: string | null) {
  const apps = applicationId
    ? await db().select().from(applications).where(eq(applications.id, applicationId))
    : await db().select().from(applications).orderBy(asc(applications.name));
  const pending = await db().select().from(proposals).where(eq(proposals.status, "pending"));
  const activity = new Map(await Promise.all(apps.map(async (a) => [a.id, await appActivity(db(), a.id)] as const)));
  const ghText = (id: string) => {
    const g = activity.get(id);
    if (!g || !g.repos.length) return "GitHub: no repository linked.";
    const prs = g.prs.map((p) => `#${p.number} ${p.title} (by ${p.author}${p.draft ? ", draft" : ""}, updated ${p.updatedAtGh.toISOString().slice(0, 10)})`);
    const runs = g.runs.map((r) => `${r.name} on ${r.headBranch ?? "?"}: ${r.conclusion ?? r.status} (${r.updatedAtGh.toISOString().slice(0, 16)}Z)`);
    const iss = g.openIssues.map((i) => `#${i.number} ${i.title}${i.labels.length ? ` [${i.labels.join(", ")}]` : ""}`);
    return [
      `GitHub repos: ${g.repos.map((r) => r.fullName).join(", ")}`,
      `Open PRs (${prs.length}): ${prs.join("; ") || "none"}`,
      `Recent workflow runs: ${runs.join("; ") || "none"}`,
      `Open issues (${iss.length}): ${iss.join("; ") || "none"}`,
      `Latest release: ${g.latestReleases[0]?.tagName ?? "none"}`,
    ].join("\n");
  };
  const appText = apps
    .map((a) =>
      [
        `## ${a.name}`,
        a.description && `Description: ${a.description}`,
        a.techStack && `Stack: ${a.techStack}`,
        a.repositoryUrl && `Repository: ${a.repositoryUrl}`,
        a.productionUrl && `Production URL: ${a.productionUrl}`,
        a.deploymentProvider && `Deploys on: ${a.deploymentProvider}`,
        `Status: ${a.status}`,
        a.latestVersion && `Latest version: ${a.latestVersion}`,
        a.knownIssues && `Known issues: ${a.knownIssues}`,
        a.pendingTasks && `Pending tasks: ${a.pendingTasks}`,
        a.roadmap && `Roadmap: ${a.roadmap}`,
        a.contextNotes && `Owner's notes: ${a.contextNotes}`,
        ghText(a.id),
        `Monitoring: not connected yet (no health evidence).`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
  return redact(
    `# Registered applications\n${appText || "None registered yet."}\n\n# Pending approvals: ${pending.length}`,
  );
}

export async function chat(message: string, applicationId: string | null) {
  const clean = redact(message.trim()).slice(0, 8000);
  await db().insert(chatMessages).values({ role: "user", content: clean, applicationId });

  const { ANTHROPIC_API_KEY, ANTHROPIC_MODEL } = env();
  let reply: string;
  if (!ANTHROPIC_API_KEY) {
    reply = "AI isn't configured yet. Add ANTHROPIC_API_KEY on the server to enable chat.";
  } else {
    const history = (
      await db()
        .select()
        .from(chatMessages)
        .where(applicationId ? eq(chatMessages.applicationId, applicationId) : isNull(chatMessages.applicationId))
        .orderBy(desc(chatMessages.createdAt))
        .limit(20)
    ).reverse();
    while (history.length && history[0].role !== "user") history.shift(); // API needs a user turn first
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      system: `${SYSTEM}\n\n${await buildContext(applicationId)}`,
      messages: history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    });
    reply = res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
  }
  await db().insert(chatMessages).values({ role: "assistant", content: reply, applicationId });
  return reply;
}
