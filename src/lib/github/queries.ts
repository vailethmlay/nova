import { and, count, desc, eq, gt, inArray } from "drizzle-orm";
import { githubRepos, issues, pullRequests, releases, workflowRuns } from "@/db/schema";
import type { Db } from "@/db/types";

export const FAILED = ["failure", "timed_out", "startup_failure"];

/** Counts for the command center. Removed repos are excluded. */
export async function githubCounts(db: Db) {
  const weekAgo = new Date(Date.now() - 7 * 86400_000);
  const monthAgo = new Date(Date.now() - 30 * 86400_000);
  const active = db.select({ id: githubRepos.id }).from(githubRepos).where(eq(githubRepos.removed, false));
  const [[repos], [prs], [failed], [open], [rel]] = await Promise.all([
    db.select({ n: count() }).from(githubRepos).where(eq(githubRepos.removed, false)),
    db.select({ n: count() }).from(pullRequests).where(and(eq(pullRequests.state, "open"), inArray(pullRequests.repoId, active))),
    db.select({ n: count() }).from(workflowRuns).where(and(inArray(workflowRuns.conclusion, FAILED), gt(workflowRuns.updatedAtGh, weekAgo), inArray(workflowRuns.repoId, active))),
    db.select({ n: count() }).from(issues).where(and(eq(issues.state, "open"), inArray(issues.repoId, active))),
    db.select({ n: count() }).from(releases).where(and(gt(releases.publishedAt, monthAgo), inArray(releases.repoId, active))),
  ]);
  return { repos: repos.n, openPrs: prs.n, failedRuns7d: failed.n, openIssues: open.n, releases30d: rel.n };
}

/** GitHub activity for one application's linked repositories. */
export async function appActivity(db: Db, applicationId: string) {
  const repos = await db
    .select()
    .from(githubRepos)
    .where(and(eq(githubRepos.applicationId, applicationId), eq(githubRepos.removed, false)));
  const ids = repos.map((r) => r.id);
  if (!ids.length) return { repos, prs: [], runs: [], openIssues: [], latestReleases: [] };
  const [prs, runs, openIssues, latestReleases] = await Promise.all([
    db.select().from(pullRequests).where(and(inArray(pullRequests.repoId, ids), eq(pullRequests.state, "open"))).orderBy(desc(pullRequests.updatedAtGh)).limit(20),
    db.select().from(workflowRuns).where(inArray(workflowRuns.repoId, ids)).orderBy(desc(workflowRuns.updatedAtGh)).limit(10),
    db.select().from(issues).where(and(inArray(issues.repoId, ids), eq(issues.state, "open"))).orderBy(desc(issues.updatedAtGh)).limit(15),
    db.select().from(releases).where(inArray(releases.repoId, ids)).orderBy(desc(releases.publishedAt)).limit(3),
  ]);
  return { repos, prs, runs, openIssues, latestReleases };
}
