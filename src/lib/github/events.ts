import { and, eq, isNull } from "drizzle-orm";
import { githubRepos, workflowRuns } from "@/db/schema";
import type { Db } from "@/db/types";
import { appendAudit } from "@/lib/audit";
import {
  markReposRemoved,
  upsertIssue,
  upsertPull,
  upsertRelease,
  upsertRepo,
  upsertRun,
  type GhIssue,
  type GhPull,
  type GhRelease,
  type GhRepo,
  type GhRun,
} from "./store";

export type Alert = { kind: "build_failed" | "pr_opened" | "release_published"; text: string; url: string };

type Payload = {
  action?: string;
  installation?: { id: number };
  repository?: GhRepo;
  pull_request?: GhPull;
  workflow_run?: GhRun;
  issue?: GhIssue;
  release?: GhRelease;
  repositories_added?: Array<{ id: number; full_name: string; private: boolean }>;
  repositories_removed?: Array<{ id: number }>;
};

/**
 * Applies one GitHub webhook event to NOVA's read-only mirror and returns any alerts to send.
 * Never calls GitHub and never writes to it.
 */
export async function applyGithubEvent(db: Db, event: string, p: Payload): Promise<Alert[]> {
  const installationId = p.installation?.id;
  const alerts: Alert[] = [];

  if (event === "installation_repositories" && installationId) {
    for (const r of p.repositories_added ?? []) {
      await upsertRepo(db, installationId, {
        id: r.id,
        full_name: r.full_name,
        private: r.private,
        html_url: `https://github.com/${r.full_name}`,
      });
    }
    for (const r of p.repositories_removed ?? []) {
      await db.update(githubRepos).set({ removed: true }).where(eq(githubRepos.id, r.id));
    }
    await appendAudit(db, {
      actor: "system",
      event: "github.repositories_changed",
      details: { added: (p.repositories_added ?? []).map((r) => r.full_name), removed: (p.repositories_removed ?? []).length },
    });
    return alerts;
  }
  if (event === "installation" && installationId && p.action === "deleted") {
    await markReposRemoved(db, installationId, []);
    await appendAudit(db, { actor: "system", event: "github.app_uninstalled", details: { installationId } });
    return alerts;
  }

  const repo = p.repository;
  if (!repo || !installationId) return alerts;
  await upsertRepo(db, installationId, repo);

  if (event === "pull_request" && p.pull_request) {
    const { isNew } = await upsertPull(db, repo.id, p.pull_request);
    if (p.action === "opened" && isNew && !p.pull_request.draft) {
      alerts.push({
        kind: "pr_opened",
        text: `New PR #${p.pull_request.number} in ${repo.full_name}: ${p.pull_request.title}`,
        url: p.pull_request.html_url,
      });
    }
  } else if (event === "workflow_run" && p.workflow_run) {
    const run = p.workflow_run;
    await upsertRun(db, repo.id, run);
    const failed = run.status === "completed" && ["failure", "timed_out", "startup_failure"].includes(run.conclusion ?? "");
    if (failed && run.head_branch === (repo.default_branch ?? "main")) {
      // Alert once per run, even if GitHub redelivers.
      const marked = await db
        .update(workflowRuns)
        .set({ alertedAt: new Date() })
        .where(and(eq(workflowRuns.id, run.id), isNull(workflowRuns.alertedAt)))
        .returning({ id: workflowRuns.id });
      if (marked.length) {
        alerts.push({
          kind: "build_failed",
          text: `Build failed: ${run.name ?? "workflow"} on ${repo.full_name} (${run.head_branch})`,
          url: run.html_url,
        });
      }
    }
  } else if (event === "issues" && p.issue) {
    await upsertIssue(db, repo.id, p.issue);
  } else if (event === "release" && p.release && p.action === "published") {
    await upsertRelease(db, repo.id, p.release);
    alerts.push({
      kind: "release_published",
      text: `Release ${p.release.tag_name} published in ${repo.full_name}`,
      url: p.release.html_url,
    });
  }
  return alerts;
}
