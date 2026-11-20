import { and, eq, inArray, notInArray } from "drizzle-orm";
import { githubRepos, issues, pullRequests, releases, workflowRuns } from "@/db/schema";
import type { Db } from "@/db/types";

/* Minimal shapes of GitHub REST/webhook objects that NOVA stores. Read-only data. */
export type GhRepo = { id: number; full_name: string; default_branch?: string; private: boolean; html_url: string };
export type GhPull = {
  id: number;
  number: number;
  title: string;
  user: { login: string } | null;
  state: string;
  merged_at?: string | null;
  draft?: boolean;
  head: { ref: string; sha: string };
  base: { ref: string };
  html_url: string;
  created_at: string;
  updated_at: string;
};
export type GhRun = {
  id: number;
  name?: string | null;
  event: string;
  status: string | null;
  conclusion: string | null;
  head_branch: string | null;
  head_sha: string;
  html_url: string;
  created_at: string;
  updated_at: string;
};
export type GhIssue = {
  id: number;
  number: number;
  title: string;
  state: string;
  labels: Array<string | { name?: string }>;
  html_url: string;
  updated_at: string;
  pull_request?: unknown;
};
export type GhRelease = {
  id: number;
  tag_name: string;
  name: string | null;
  prerelease: boolean;
  html_url: string;
  published_at: string | null;
};

export async function upsertRepo(db: Db, installationId: number, r: GhRepo) {
  const values = {
    id: r.id,
    fullName: r.full_name,
    installationId,
    defaultBranch: r.default_branch ?? "main",
    isPrivate: r.private,
    htmlUrl: r.html_url,
    removed: false,
  };
  await db.insert(githubRepos).values(values).onConflictDoUpdate({ target: githubRepos.id, set: values });
}

export async function markReposRemoved(db: Db, installationId: number, keepIds: number[]) {
  const where = keepIds.length
    ? and(eq(githubRepos.installationId, installationId), notInArray(githubRepos.id, keepIds))
    : eq(githubRepos.installationId, installationId);
  await db.update(githubRepos).set({ removed: true }).where(where);
}

export async function upsertPull(db: Db, repoId: number, p: GhPull) {
  const values = {
    id: p.id,
    repoId,
    number: p.number,
    title: p.title,
    author: p.user?.login ?? "unknown",
    state: p.merged_at ? "merged" : p.state,
    draft: p.draft ?? false,
    headRef: p.head.ref,
    headSha: p.head.sha,
    baseRef: p.base.ref,
    htmlUrl: p.html_url,
    createdAtGh: new Date(p.created_at),
    updatedAtGh: new Date(p.updated_at),
  };
  const [before] = await db.select({ id: pullRequests.id }).from(pullRequests).where(eq(pullRequests.id, p.id));
  await db.insert(pullRequests).values(values).onConflictDoUpdate({ target: pullRequests.id, set: values });
  return { isNew: !before };
}

/** After a full listing of open PRs, any PR still stored as open but not listed has closed. */
export async function closeMissingPulls(db: Db, repoId: number, openIds: number[]) {
  const where = openIds.length
    ? and(eq(pullRequests.repoId, repoId), eq(pullRequests.state, "open"), notInArray(pullRequests.id, openIds))
    : and(eq(pullRequests.repoId, repoId), eq(pullRequests.state, "open"));
  await db.update(pullRequests).set({ state: "closed" }).where(where);
}

export async function upsertRun(db: Db, repoId: number, r: GhRun) {
  const values = {
    id: r.id,
    repoId,
    name: r.name ?? "workflow",
    event: r.event,
    status: r.status ?? "unknown",
    conclusion: r.conclusion,
    headBranch: r.head_branch,
    headSha: r.head_sha,
    htmlUrl: r.html_url,
    createdAtGh: new Date(r.created_at),
    updatedAtGh: new Date(r.updated_at),
  };
  await db.insert(workflowRuns).values(values).onConflictDoUpdate({ target: workflowRuns.id, set: values });
}

export async function upsertIssue(db: Db, repoId: number, i: GhIssue) {
  if (i.pull_request) return; // the issues API also returns PRs
  const values = {
    id: i.id,
    repoId,
    number: i.number,
    title: i.title,
    state: i.state,
    labels: i.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean),
    htmlUrl: i.html_url,
    updatedAtGh: new Date(i.updated_at),
  };
  await db.insert(issues).values(values).onConflictDoUpdate({ target: issues.id, set: values });
}

export async function closeMissingIssues(db: Db, repoId: number, openIds: number[]) {
  const where = openIds.length
    ? and(eq(issues.repoId, repoId), eq(issues.state, "open"), notInArray(issues.id, openIds))
    : and(eq(issues.repoId, repoId), eq(issues.state, "open"));
  await db.update(issues).set({ state: "closed" }).where(where);
}

export async function upsertRelease(db: Db, repoId: number, r: GhRelease) {
  const values = {
    id: r.id,
    repoId,
    tagName: r.tag_name,
    name: r.name,
    prerelease: r.prerelease,
    htmlUrl: r.html_url,
    publishedAt: r.published_at ? new Date(r.published_at) : null,
  };
  await db.insert(releases).values(values).onConflictDoUpdate({ target: releases.id, set: values });
}

export async function repoExists(db: Db, repoId: number) {
  const rows = await db.select({ id: githubRepos.id }).from(githubRepos).where(inArray(githubRepos.id, [repoId]));
  return rows.length > 0;
}
