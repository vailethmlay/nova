import { eq } from "drizzle-orm";
import type { App } from "octokit";
import { githubRepos } from "@/db/schema";
import type { Db } from "@/db/types";
import { appendAudit } from "@/lib/audit";
import {
  closeMissingIssues,
  closeMissingPulls,
  markReposRemoved,
  upsertIssue,
  upsertPull,
  upsertRelease,
  upsertRepo,
  upsertRun,
} from "./store";

/**
 * Full read-only resync of every repository the GitHub App is installed on.
 * Uses only GET endpoints. octokit's built-in throttling and retry plugins handle rate limits.
 */
export async function syncGithub(db: Db, app: App) {
  const seen = new Map<number, number[]>(); // installationId -> repo ids
  let repoCount = 0;
  const errors: string[] = [];

  for await (const { octokit, repository } of app.eachRepository.iterator()) {
    const [owner, repo] = repository.full_name.split("/");
    // eachRepository does not expose the installation id directly; read it once per repo.
    const { data: inst } = await octokit.request("GET /repos/{owner}/{repo}/installation", { owner, repo });
    const installationId = Number(inst.id);
    const repoId = Number(repository.id); // octokit types ids as number | bigint
    seen.set(installationId, [...(seen.get(installationId) ?? []), repoId]);
    repoCount++;
    try {
      await upsertRepo(db, installationId, { ...repository, id: repoId });

      const pulls = await octokit.paginate(octokit.rest.pulls.list, { owner, repo, state: "open", per_page: 100 });
      for (const p of pulls) await upsertPull(db, repoId, p);
      await closeMissingPulls(db, repoId, pulls.map((p) => p.id));

      const runs = await octokit.rest.actions.listWorkflowRunsForRepo({ owner, repo, per_page: 30 });
      for (const r of runs.data.workflow_runs) await upsertRun(db, repoId, r);

      const open = (await octokit.paginate(octokit.rest.issues.listForRepo, { owner, repo, state: "open", per_page: 100 }))
        .filter((i) => !i.pull_request);
      for (const i of open) await upsertIssue(db, repoId, i);
      await closeMissingIssues(db, repoId, open.map((i) => i.id));

      const rel = await octokit.rest.repos.listReleases({ owner, repo, per_page: 5 });
      for (const r of rel.data) await upsertRelease(db, repoId, r);

      await db.update(githubRepos).set({ lastSyncedAt: new Date() }).where(eq(githubRepos.id, repoId));
    } catch (e) {
      errors.push(`${repository.full_name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  for (const [installationId, ids] of seen) await markReposRemoved(db, installationId, ids);
  await appendAudit(db, { actor: "system", event: "github.sync", details: { repos: repoCount, errors } });
  return { repos: repoCount, errors };
}
