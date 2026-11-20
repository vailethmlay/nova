import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { applications, githubRepos } from "@/db/schema";
import { githubConfig } from "@/lib/env";
import { eat } from "@/lib/format";
import { linkRepo, syncNow } from "./actions";

export default async function ReposPage() {
  const cfg = githubConfig();
  const [repos, apps] = await Promise.all([
    db().select().from(githubRepos).where(eq(githubRepos.removed, false)).orderBy(asc(githubRepos.fullName)),
    db().select({ id: applications.id, name: applications.name }).from(applications).orderBy(asc(applications.name)),
  ]);
  return (
    <>
      <h1>Repositories</h1>
      {!cfg ? (
        <p className="card tint">GitHub isn't connected yet. Follow SETUP.md to create the read-only GitHub App.</p>
      ) : (
        <div style={{ display: "flex", gap: 8, marginBottom: 24, alignItems: "center" }}>
          <form action={syncNow}><button className="secondary">Sync now</button></form>
          {cfg.slug && (
            <a className="btn" href={`https://github.com/apps/${cfg.slug}/installations/new`} target="_blank" rel="noreferrer">
              Add or remove repositories
            </a>
          )}
          <span className="muted">NOVA has read-only access. It can't push, merge or change anything on GitHub.</span>
        </div>
      )}
      <table>
        <thead><tr><th>Repository</th><th>Default branch</th><th>Application</th><th>Last synced</th></tr></thead>
        <tbody>
          {repos.map((r) => (
            <tr key={r.id}>
              <td><a href={r.htmlUrl} target="_blank" rel="noreferrer">{r.fullName}</a>{r.isPrivate && <span className="pill" style={{ marginLeft: 8 }}>private</span>}</td>
              <td><code>{r.defaultBranch}</code></td>
              <td>
                <form action={linkRepo} style={{ display: "flex", gap: 8 }}>
                  <input type="hidden" name="repoId" value={r.id} />
                  <select name="applicationId" defaultValue={r.applicationId ?? ""}>
                    <option value="">Not linked</option>
                    {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <button className="secondary">Save</button>
                </form>
              </td>
              <td>{eat(r.lastSyncedAt)}</td>
            </tr>
          ))}
          {repos.length === 0 && <tr><td colSpan={4} className="muted">No repositories yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
