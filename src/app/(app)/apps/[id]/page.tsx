import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { applications } from "@/db/schema";
import { AppForm } from "@/components/AppForm";
import { eat } from "@/lib/format";
import { updateApp } from "../actions";

export default async function AppPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const [app] = await db().select().from(applications).where(eq(applications.id, id));
  if (!app) notFound();
  return (
    <>
      <h1>{app.name}</h1>
      <p className="muted">
        Last updated {eat(app.updatedAt)} · Health: unknown until monitoring is connected · GitHub activity arrives in Phase 2
      </p>
      <AppForm
        action={updateApp.bind(null, app.id)}
        submitLabel="Save changes"
        app={Object.fromEntries(Object.entries(app).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : (v as string | null)]))}
      />
    </>
  );
}
