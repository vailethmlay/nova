import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { applications } from "@/db/schema";
import { AppForm } from "@/components/AppForm";
import { eat } from "@/lib/format";
import { updateApp } from "../actions";
import { appActivity, FAILED } from "@/lib/github/queries";
import Link from "next/link";

export default async function AppPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const [app] = await db().select().from(applications).where(eq(applications.id, id));
  if (!app) notFound();
  const gh = await appActivity(db(), app.id);
  return (
    <>
      <h1>{app.name}</h1>
      <p className="muted">
        Last updated {eat(app.updatedAt)} · Health: unknown until monitoring is connected (Phase 3)
      </p>
      <section style={{ marginBottom: 32 }}>
        <h2>GitHub activity</h2>
        {gh.repos.length === 0 ? (
          <p className="muted">No repository linked. Link one on the <Link href="/repos">Repositories</Link> page.</p>
        ) : (
          <>
            <p className="muted">{gh.repos.map((r) => r.fullName).join(", ")}{gh.latestReleases[0] && ` · latest release ${gh.latestReleases[0].tagName}`}</p>
            <h3>Open pull requests ({gh.prs.length})</h3>
            <table style={{ marginBottom: 16 }}>
              <tbody>
                {gh.prs.map((p) => (
                  <tr key={p.id}>
                    <td><a href={p.htmlUrl} target="_blank" rel="noreferrer">#{p.number} {p.title}</a>{p.draft && <span className="pill" style={{ marginLeft: 8 }}>draft</span>}</td>
                    <td>{p.author}</td>
                    <td><code>{p.headRef}</code> → <code>{p.baseRef}</code></td>
                    <td>{eat(p.updatedAtGh)}</td>
                  </tr>
                ))}
                {gh.prs.length === 0 && <tr><td className="muted">None open.</td></tr>}
              </tbody>
            </table>
            <h3>Recent GitHub Actions</h3>
            <table style={{ marginBottom: 16 }}>
              <tbody>
                {gh.runs.map((r) => (
                  <tr key={r.id}>
                    <td><a href={r.htmlUrl} target="_blank" rel="noreferrer">{r.name}</a></td>
                    <td><code>{r.headBranch}</code></td>
                    <td className={FAILED.includes(r.conclusion ?? "") ? "error" : r.conclusion === "success" ? "ok" : "muted"}>{r.conclusion ?? r.status}</td>
                    <td>{eat(r.updatedAtGh)}</td>
                  </tr>
                ))}
                {gh.runs.length === 0 && <tr><td className="muted">No runs yet.</td></tr>}
              </tbody>
            </table>
            <h3>Open issues ({gh.openIssues.length})</h3>
            <table>
              <tbody>
                {gh.openIssues.map((i) => (
                  <tr key={i.id}>
                    <td><a href={i.htmlUrl} target="_blank" rel="noreferrer">#{i.number} {i.title}</a></td>
                    <td>{i.labels.map((l) => <span key={l} className="pill" style={{ marginRight: 4 }}>{l}</span>)}</td>
                  </tr>
                ))}
                {gh.openIssues.length === 0 && <tr><td className="muted">None open.</td></tr>}
              </tbody>
            </table>
          </>
        )}
      </section>
      <h2>Details and memory</h2>
      <AppForm
        action={updateApp.bind(null, app.id)}
        submitLabel="Save changes"
        app={Object.fromEntries(Object.entries(app).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : (v as string | null)]))}
      />
    </>
  );
}
