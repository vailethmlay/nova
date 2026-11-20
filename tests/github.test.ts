import { beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verify } from "@octokit/webhooks-methods";
import { githubRepos, pullRequests, workflowRuns } from "@/db/schema";
import type { Db } from "@/db/types";
import { applyGithubEvent } from "@/lib/github/events";
import { closeMissingPulls } from "@/lib/github/store";
import { testDb } from "./helpers";

const repo = { id: 101, full_name: "vailethmlay/myaida", default_branch: "main", private: true, html_url: "https://github.com/vailethmlay/myaida" };
const installation = { id: 9 };
const pr = (n: number, extra: Record<string, unknown> = {}) => ({
  id: 5000 + n, number: n, title: `PR ${n}`, user: { login: "dev" }, state: "open", draft: false,
  head: { ref: `feat-${n}`, sha: "a".repeat(40) }, base: { ref: "main" },
  html_url: `https://github.com/vailethmlay/myaida/pull/${n}`, created_at: "2026-11-19T08:00:00Z", updated_at: "2026-11-19T09:00:00Z", ...extra,
});
const run = (id: number, conclusion: string, branch = "main") => ({
  id, name: "CI", event: "push", status: "completed", conclusion, head_branch: branch, head_sha: "b".repeat(40),
  html_url: `https://github.com/vailethmlay/myaida/actions/runs/${id}`, created_at: "2026-11-19T08:00:00Z", updated_at: "2026-11-19T08:05:00Z",
});

let db: Db;
beforeEach(async () => { db = (await testDb()).db; });

describe("GitHub events", () => {
  it("stores a new PR and alerts once; a redelivered 'opened' does not alert again", async () => {
    const a1 = await applyGithubEvent(db, "pull_request", { action: "opened", installation, repository: repo, pull_request: pr(1) });
    expect(a1.map((a) => a.kind)).toEqual(["pr_opened"]);
    const a2 = await applyGithubEvent(db, "pull_request", { action: "opened", installation, repository: repo, pull_request: pr(1) });
    expect(a2).toEqual([]);
    const [row] = await db.select().from(pullRequests);
    expect(row).toMatchObject({ number: 1, state: "open", repoId: 101 });
  });

  it("records merged PRs as merged", async () => {
    await applyGithubEvent(db, "pull_request", { action: "closed", installation, repository: repo, pull_request: pr(2, { state: "closed", merged_at: "2026-11-19T10:00:00Z" }) });
    expect((await db.select().from(pullRequests))[0].state).toBe("merged");
  });

  it("alerts on a failed run on the default branch only, and only once", async () => {
    expect(await applyGithubEvent(db, "workflow_run", { installation, repository: repo, workflow_run: run(1, "failure", "feature") })).toEqual([]);
    expect(await applyGithubEvent(db, "workflow_run", { installation, repository: repo, workflow_run: run(2, "success") })).toEqual([]);
    const first = await applyGithubEvent(db, "workflow_run", { installation, repository: repo, workflow_run: run(3, "failure") });
    expect(first.map((a) => a.kind)).toEqual(["build_failed"]);
    expect(await applyGithubEvent(db, "workflow_run", { installation, repository: repo, workflow_run: run(3, "failure") })).toEqual([]);
    expect(await db.select().from(workflowRuns)).toHaveLength(3);
  });

  it("ignores PRs returned by the issues API and tracks repo removal", async () => {
    await applyGithubEvent(db, "issues", { installation, repository: repo, issue: { id: 1, number: 7, title: "x", state: "open", labels: [], html_url: "u", updated_at: "2026-11-19T08:00:00Z", pull_request: {} } });
    await applyGithubEvent(db, "installation_repositories", { installation, repositories_added: [], repositories_removed: [{ id: 101 }] });
    expect((await db.select().from(githubRepos))[0].removed).toBe(true);
  });

  it("closes stored open PRs missing from a full listing", async () => {
    await applyGithubEvent(db, "pull_request", { action: "opened", installation, repository: repo, pull_request: pr(1) });
    await applyGithubEvent(db, "pull_request", { action: "opened", installation, repository: repo, pull_request: pr(2) });
    await closeMissingPulls(db, 101, [5002]);
    const rows = await db.select().from(pullRequests);
    expect(Object.fromEntries(rows.map((r) => [r.number, r.state]))).toEqual({ 1: "closed", 2: "open" });
  });
});

describe("GitHub webhook signature", () => {
  it("accepts the right secret and rejects a tampered body", async () => {
    const body = JSON.stringify({ a: 1 });
    const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
    expect(await verify("s3cret", body, sig)).toBe(true);
    expect(await verify("s3cret", body + " ", sig)).toBe(false);
    expect(await verify("other", body, sig)).toBe(false);
  });
});
