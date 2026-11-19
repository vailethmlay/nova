import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { applications } from "@/db/schema";
import { AppForm } from "@/components/AppForm";
import { eat } from "@/lib/format";
import { createApp } from "./actions";

export default async function AppsPage() {
  const apps = await db().select().from(applications).orderBy(asc(applications.name));
  return (
    <>
      <h1>Applications</h1>
      <table style={{ marginBottom: 32 }}>
        <thead><tr><th>Name</th><th>Status</th><th>Stack</th><th>Health</th><th>Updated</th></tr></thead>
        <tbody>
          {apps.map((a) => (
            <tr key={a.id}>
              <td><Link href={`/apps/${a.id}`}>{a.name}</Link></td>
              <td><span className="pill">{a.status}</span></td>
              <td>{a.techStack || "—"}</td>
              <td className="muted">Unknown (no monitoring yet)</td>
              <td>{eat(a.updatedAt)}</td>
            </tr>
          ))}
          {apps.length === 0 && <tr><td colSpan={5} className="muted">No applications yet. Register your first one below.</td></tr>}
        </tbody>
      </table>
      <h2>Register an application</h2>
      <AppForm action={createApp} submitLabel="Register application" />
    </>
  );
}
